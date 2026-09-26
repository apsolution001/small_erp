import { type Permission } from '@ekaro/contracts';
import {
  BadgeIndianRupeeIcon,
  BoxesIcon,
  Building2Icon,
  FactoryIcon,
  FileClockIcon,
  FileTextIcon,
  FolderTreeIcon,
  HashIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  NetworkIcon,
  PackageIcon,
  PercentIcon,
  ReceiptIcon,
  RulerIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  UsersIcon,
  WarehouseIcon,
  ContactIcon,
} from 'lucide-react';
import { type FileRouteTypes } from '@/routeTree.gen';

export type AppPath = FileRouteTypes['to'];

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Omitted while the screen is not built yet: the item shows, disabled, as "Soon". */
  to?: AppPath;
  /** Hidden for roles without it (`useCan`). The API enforces it regardless. */
  permission?: Permission;
  /** Extra words the command palette matches. */
  keywords?: readonly string[];
}

export interface NavGroup {
  id: string;
  label: string | null;
  items: readonly NavItem[];
}

/**
 * The app's map. Masters and settings screens arrive in T-151..T-154, which set `to`; the
 * transaction modules follow in sprints 2–5 (BRD §7).
 */
export const NAV: readonly NavGroup[] = [
  {
    id: 'home',
    label: null,
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboardIcon, to: '/' }],
  },
  {
    id: 'masters',
    label: 'Masters',
    items: [
      {
        id: 'company',
        label: 'Company',
        icon: Building2Icon,
        permission: 'masters.company:view',
        keywords: ['gstin', 'profile'],
      },
      { id: 'branches', label: 'Branches', icon: NetworkIcon, permission: 'masters.branch:view' },
      { id: 'godowns', label: 'Godowns', icon: WarehouseIcon, permission: 'masters.godown:view' },
      {
        id: 'units',
        label: 'Units',
        icon: RulerIcon,
        permission: 'masters.unit:view',
        keywords: ['uqc', 'uom'],
      },
      {
        id: 'tax-rates',
        label: 'Tax rates',
        icon: PercentIcon,
        permission: 'masters.tax_rate:view',
        keywords: ['gst', 'slab'],
      },
      {
        id: 'categories',
        label: 'Categories',
        icon: FolderTreeIcon,
        permission: 'masters.item_category:view',
      },
      {
        id: 'items',
        label: 'Items',
        icon: PackageIcon,
        permission: 'masters.item:view',
        keywords: ['product', 'stock item', 'hsn'],
      },
      {
        id: 'parties',
        label: 'Parties',
        icon: ContactIcon,
        permission: 'masters.party:view',
        keywords: ['customer', 'vendor', 'supplier', 'ledger'],
      },
      {
        id: 'series',
        label: 'Series',
        icon: HashIcon,
        permission: 'masters.series:view',
        keywords: ['numbering', 'voucher'],
      },
    ],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    items: [
      { id: 'purchase', label: 'Purchase', icon: ShoppingCartIcon },
      { id: 'sales', label: 'Sales', icon: ReceiptIcon },
      { id: 'inventory', label: 'Inventory', icon: BoxesIcon },
      { id: 'production', label: 'Production', icon: FactoryIcon },
      { id: 'accounts', label: 'Accounts', icon: LandmarkIcon },
      { id: 'gst', label: 'GST returns', icon: BadgeIndianRupeeIcon },
      { id: 'reports', label: 'Reports', icon: FileTextIcon },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { id: 'users', label: 'Users', icon: UsersIcon, permission: 'access.user:view' },
      { id: 'roles', label: 'Roles', icon: ShieldCheckIcon, permission: 'access.role:view' },
      { id: 'audit', label: 'Audit log', icon: FileClockIcon, permission: 'audit.log:view' },
    ],
  },
];

/** The navigation a role may see: groups keep only permitted items; empty groups drop out. */
export function visibleNav(
  can: (permission: Permission) => boolean,
  nav: readonly NavGroup[] = NAV,
): NavGroup[] {
  return nav
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.permission === undefined || can(item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}
