# Spec 02 — Masters & setup

BRD refs: MS-01..MS-06, §13. ADRs: 0003, 0004, 0005, 0010. All tables are tenant tables: standard columns plus RLS plus the audit trigger (see `docs/standards/database.md`).

## 1. Reference data in code (`@ekaro/core`)

- **Indian states and UTs** with GST state codes (`01` J&K … `38` Ladakh, `97` Other Territory) → `STATES`, `isValidStateCode`. The legacy codes **25** (Daman and Diu, merged into 26 in 2020) and **28** (Andhra Pradesh before 2014, now 37) stay in the table for back-dated documents only. Every master address and state field, every GSTIN and every new supply uses a **current** code (`CURRENT_STATE_CODES`, `currentStateCodeSchema`), which excludes them.
- **Place of supply** codes (`PLACE_OF_SUPPLY_CODES`, `placeOfSupplySchema`): the current state codes plus **96** (Other Countries) and **99** (Centre Jurisdiction). 96 and 99 are never an address state or a GSTIN prefix. A place of supply of 96 is always inter-state (IGST).
- **GSTIN**: format `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, mod-36 checksum, and a current state code (25 and 28 are rejected). The state code is the first 2 characters and the PAN is characters 3–12.
- **UQC list** (GST unit quantity codes: NOS, KGS, MTR, LTR, BOX, PCS, SET, TON, ...) → seeded as units. It includes **NA**, which the GSTR-1 HSN summary uses for services.
- **Financial year** helpers: `fyOf(date) → '2026-27'`, `fyRange('2026-27')`.

## 2. Tables

**company_profile** (1 row per tenant, PK = tenant_id)
legal_name, trade_name, gstin char(15) null (unregistered businesses allowed), pan, state_code char(2), address fields (line1, line2, city, pincode, state_code), email, phone, logo_object_key, books_begin_date date (locked after the first posting), valuation_method `fifo|weighted_average` (locked after the first posting), both locks enforced by the services (T-106 for the company PATCH, Sprint 2 for the first posting), allow_negative_stock bool default false, round_off_sales bool default true, hsn_min_digits smallint `4|6` default 4, e_invoice_enabled bool default false, version.

**branches**
code (≤10, unique per tenant), name, gstin null (a branch in another state has its own GSTIN, whose state code must equal the branch state), state_code, address fields, is_head_office (exactly one per tenant, enforced by a partial unique index), is_active.

**godowns**
branch_id → branches, code (unique per tenant), name, address null, allow_negative_stock bool default false, is_active.

**units**
code (unique per tenant, uppercase, ≤10), name, uqc (one of the GST UQC codes, used in GSTR/e-invoice), decimal_places smallint 0–6, is_active.

**tax_rates** (GST slab definitions)
name (for example "GST 18%"), gst_rate numeric(7,4) (the total rate. The split is derived: CGST = SGST = rate/2, IGST = rate), cess_rate numeric(7,4) default 0 (ad-valorem cess only; specific or per-unit cess is out of V1 scope), is_exempt bool, is_nil_rated bool, is_non_gst bool, is_active. **A slab is immutable in its rate fields** (gst_rate, cess_rate and the three flags): documents already reference it. `PATCH /tax-rates/:id` accepts only `name`, `isActive` and `version`. A rate change is a new slab plus an effective-dated `item_tax_rates` row (a deliberate deviation from full CRUD, see spec 01 §2). Unique (tenant, gst_rate, cess_rate, is_exempt, is_nil_rated, is_non_gst). The seeds reflect the current GST slabs: 0 (nil), exempt, 0.25, 1.5, 3, 5, 18, 40, plus legacy 12 and 28 marked inactive, kept for back-dated documents.

**item_categories**
parent_id null (self-reference, max depth 3), name (unique per parent), is_active.

**items** (MS-02)
code (≤30, unique per tenant), name (≤200), description, item_type `goods|service`, item_kind `raw_material|semi_finished|finished_good|trading|consumable|scrap|service`, category_id null, hsn_sac (digits only: 4/6/8 for goods, SAC 6 digits for services, length ≥ company.hsn_min_digits), base_unit_id → units, purchase_unit_id null, sales_unit_id null, reorder_level numeric(20,6) null, reorder_qty numeric(20,6) null, min_order_qty null, track_batches bool, track_expiry bool (requires track_batches), standard_purchase_rate numeric(20,6) null, standard_sales_rate numeric(20,6) null, is_active, version.

**item_units** (UoM conversions)
item_id, unit_id, factor_to_base numeric(20,6) > 0. Unique (item_id, unit_id). The base unit has an implicit factor of 1 and is not stored. Example: item base KGS, BAG = 50.

**item_tax_rates** (effective-dated GST, needed because rates change, as in GST 2.0)
item_id, tax_rate_id, effective_from date. Unique (item_id, effective_from). The rate applied on a document date is the latest row with `effective_from ≤ date`. Creating an item requires an initial rate (effective_from = company books_begin_date). Rows are never edited: a rate change adds a row. Permissions: `masters.item_tax_rate:view` to list, `masters.item_tax_rate:create` to add (spec 01 §2).

**parties** (MS-03)
code (unique per tenant), name, party_type `customer|vendor|both`, gst_registration_type `regular|composition|unregistered|consumer|overseas|sez`, gstin (required when regular, composition or sez. Its state code must equal the billing address state), pan, credit_limit bigint null (paise; null = no limit, 0 = cash only; money columns carry no unit suffix because the type conveys it), credit_days int null, payment_terms text null, contact_person, email, phone, notes, is_active, version.

**party_addresses**
party_id, kind `billing|shipping`, label, line1, line2, city, state_code (current codes only; null abroad), pincode (6 digits in India), country default 'IN', is_default. Exactly one default billing address per party (partial unique index).

**document_series** (MS-05, ADR 0010)
branch_id, doc_type (enum in contracts: `purchase_requisition, purchase_order, grn, purchase_invoice, debit_note, quotation, sales_order, delivery_challan, sales_invoice, credit_note, stock_transfer, stock_adjustment, work_order, material_issue, production_entry, job_work_out, job_work_in, payment, receipt, contra, journal`), fy text (`YYYY-YY`), prefix (≤10), suffix (≤6), padding (1–8), next_number bigint ≥ 1, is_default bool. Unique (tenant, branch, doc_type, fy, prefix, suffix). One default per (branch, doc_type, fy). Validation (GST rule 46 and the e-invoice schema): prefix and suffix are upper-cased on input and use `[A-Za-z0-9/-]`; the width `len(prefix) + digits(max(10^padding − 1, next_number)) + len(suffix)` stays ≤ 16; the first rendered character is `[A-Za-z1-9]` (a prefix starts with a letter or 1–9, and a series without a prefix must not render a leading zero). Allocation is in the posting transaction (`allocate(seriesId)` with `FOR UPDATE`, Sprint 2), and the series is auto-created for a new FY by rolling over the previous FY's prefix pattern.

The series service (T-106) must also enforce:

- `next_number`, `prefix`, `suffix` and `padding` can change **only while the series has issued nothing**. Once a number is issued they are fixed (only `is_default` can change), so the issued sequence stays gapless and consistent.
- The **rendered number is unique per (GSTIN, document family, FY)**: two series of the same branch GSTIN whose document types share a GSTR-1 family (for example, sales invoices, or credit and debit notes) must never render the same number in the same FY. The e-invoice IRN is keyed on GSTIN + document type + number + FY.

## 3. Endpoints (all under `/api/v1`, standard list semantics)

| Resource        | Routes                                                                                                   | Notes                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| company         | `GET /company`, `PATCH /company`                                                                         | valuation_method editable only until the first stock posting                     |
| branches        | CRUD `/branches`                                                                                         | cannot deactivate the head office; cannot deactivate while it has active godowns |
| godowns         | CRUD `/godowns` (`?branchId=`)                                                                           |                                                                                  |
| units           | CRUD `/units`                                                                                            | a unit used by an item cannot be deleted (409 `IN_USE`); deactivate instead      |
| tax-rates       | CRUD `/tax-rates`                                                                                        | PATCH changes `name` and `isActive` only; rates are immutable                    |
| item-categories | CRUD `/item-categories` (tree in response with `?tree=true`)                                             |                                                                                  |
| items           | CRUD `/items` (`?q=&kind=&categoryId=&active=`), `GET /items/:id/tax-rates`, `POST /items/:id/tax-rates` | units and conversions are nested in the create/update payload                    |
| parties         | CRUD `/parties` (`?q=&type=&active=`)                                                                    | addresses nested in the payload                                                  |
| series          | `GET/POST/PATCH /document-series`                                                                        | `next_number` can only increase; numbering fields fixed once a number is issued  |

**Updates.** A PATCH body (`xUpdateSchema`) is strict, has no defaults, needs `version` and at least one field. It checks each field only. Before saving, the service validates the merged record with the entity's record schema, `xRecordSchema.parse({ ...existing, ...patch })`, which runs the cross-field rules (GSTIN vs state, track_expiry, series width, …) on the whole record. List queries are strict and each declares its own `sort` columns.

DELETE on a master is soft (it sets is_active = false) once referenced. Referencing tables arrive in later sprints, so the Sprint 1 rule is: masters are **deactivated**, never hard deleted, except units, tax rates and categories that are unreferenced.

## 4. Seeds per tenant (in the bootstrap, idempotent)

Units: NOS, PCS, KGS, GMS, TON, MTR, CMS, LTR, MLT, BOX, BAG, SET, PAC, ROL, SQM, SQF, DOZ, OTH (mapped to UQC). Tax rates: as above. Series: default series for every doc_type for the head office for the current FY, with prefixes like `SI/26-27/` (sales invoice), `PO/26-27/`, … and padding 4, so `SI/26-27/0001` is 13 characters.

## 5. Acceptance criteria

- Every master has CRUD, search, pagination, optimistic locking, audit rows and isolation tests.
- GSTIN checksum and state-code consistency are enforced on company, branches and parties.
- An item with UoM conversions round-trips exactly (decimal strings preserved). The effective-dated tax rate lookup returns the right slab for a given date.
- Series validation rejects numbers that would exceed 16 characters.
