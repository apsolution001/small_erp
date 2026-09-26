-- T-106 guards on document_series (spec 02 §2, ADR 0010, GST rule 46). Runs as ekaro_owner.
-- The table already has RLS, grants and the audit trigger (migration 0004).

------------------------------------------------------------------------------------------------
-- A series keeps issued numbers gapless and consistent:
--  * branch, document type and FY identify the series and never change;
--  * the next number never goes back;
--  * once a number is issued (last_issued_number set, by allocation in Sprint 2), the prefix,
--    suffix and padding are fixed, and last_issued_number only moves forward. Together with the
--    check `next_number = last_issued_number + 1`, the next number is then fixed as well.
-- The API enforces the same rules with readable errors; this trigger holds them for any writer.
------------------------------------------------------------------------------------------------
create function document_series_numbering_guard() returns trigger
  language plpgsql
  as $$
begin
  if (new.branch_id, new.doc_type, new.fy) is distinct from (old.branch_id, old.doc_type, old.fy) then
    raise exception 'Document series %: branch, document type and FY cannot change', old.id
      using errcode = 'check_violation', constraint = 'document_series_identity_immutable';
  end if;
  if new.next_number < old.next_number then
    raise exception 'Document series %: the next number cannot go back', old.id
      using errcode = 'check_violation', constraint = 'document_series_next_number_forward';
  end if;
  if old.last_issued_number is not null
     and ((new.prefix, new.suffix, new.padding) is distinct from (old.prefix, old.suffix, old.padding)
          or new.last_issued_number is null
          or new.last_issued_number < old.last_issued_number) then
    raise exception 'Document series %: numbers are issued, so its numbering is fixed', old.id
      using errcode = 'check_violation', constraint = 'document_series_numbering_locked';
  end if;
  return new;
end
$$;

create trigger document_series_numbering_guard
  before update on document_series
  for each row execute function document_series_numbering_guard();
