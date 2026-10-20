import React, { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSapWindowTaskbar, useSapWindowTaskbarActions } from './SapWindowTaskbarContext';
import { normalizePath } from '../auth/routeUtils';
import { restoreTargetWindowState } from '../utils/copyToState';
import {
  createMenuWindowRouteState,
  supportsMultipleMenuWindows,
} from '../utils/menuWindowNavigation';
import { matchesSapSearchText } from '../utils/sapSearch';
import { mergeReportSidebarRoots } from '../utils/mergeReportSidebarRoots';
import '../styles/sidebar.css';

const DASHBOARD_PATH = '/dashboard';
const STATIC_DASHBOARD_MENU = {
  menuId: 'dashboard-static',
  menuName: 'Dashboard',
  menuPath: DASHBOARD_PATH,
  parentId: null,
  icon: 'dashboard',
  sortOrder: -1,
  children: [],
};
const SIDEBAR_COLLAPSED_KEY = 'sap-b1-sidebar-collapsed';

const TOP_LEVEL_MENU_PRIORITY = new Map([
  ['dashboard', 0],
  ['sales', 1],
  ['sales a r', 1],
  ['services', 2],
  ['purchase', 3],
  ['purchase a p', 3],
  ['purchasing', 3],
  ['purchasing a p', 3],
  ['master', 4],
  ['production', 5],
  ['inventory', 6],
  ['quality control', 6.5],
  ['banking', 7],
  ['reports', 8],
  ['report layout manager', 9],
  ['reportlayoutmanager', 9],
  ['settings', 10],
  ['general settings', 10],
  ['admin panel', 11],
  ['query manager', 12],
]);

const REPORT_STUDIO_NAMES = new Set(['report studio', 'report layout manager', 'reportlayoutmanager']);
const REPORTS_MENU_NAME = 'reports';
const BUSINESS_PARTNER_REPORT_WRAPPER_NAMES = new Set([
  'business partner reports',
  'business partners reports',
]);
const SALES_MENU_NAMES = new Set(['sales', 'sales a r']);
const SALES_CHILD_PRIORITY = new Map([
  ['sales quotation', 1],
  ['sales order', 2],
  ['transaction field configuration', 2.5],
  ['delivery', 6],
  ['a r invoice', 10],
  ['a r credit memo', 11],
]);
const SALES_CHILD_PATH_PRIORITY = new Map([
  ['/sales-quotation', 1],
  ['/sales-order', 2],
  ['/delivery', 6],
  ['/ar-invoice', 10],
  ['/ar-credit-memo', 11],
]);
const isAdminMenuPath = (menuPath = '') => normalizePath(menuPath).startsWith('/admin');
const getDisplayMenuName = (menu) => {
  const normalized = normalizeMenuPriorityName(menu?.menuName);
  if (normalized === 'sales' && !menu?.parentId) {
    return 'Sales - A/R';
  }
  if (REPORT_STUDIO_NAMES.has(normalized)) {
    return 'Report Layout Manager';
  }

  return menu?.menuName;
};

const normalizeMenuPriorityName = (menuName) =>
  String(menuName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const ICON_PATHS = {
  dashboard: ['M4 5h6v6H4z', 'M14 5h6v4h-6z', 'M14 13h6v6h-6z', 'M4 15h6v4H4z'],
  sales: ['M5 7h14l-1.4 7.2H7.1z', 'M8 7 7.2 4H4', 'M8.5 19a1.2 1.2 0 1 0 0-.01', 'M16.5 19a1.2 1.2 0 1 0 0-.01'],
  services: ['M14.7 5.3a4 4 0 0 0 4.8 4.8l-7.8 7.8a2.3 2.3 0 0 1-3.2-3.2z', 'M6 18l-2 2'],
  purchase: ['M6 8h12l-1 12H7z', 'M9 8a3 3 0 0 1 6 0'],
  master: ['M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z', 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6', 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6'],
  production: ['M9 3h6l1 3 3 1v6l-3 1-1 3H9l-1-3-3-1V7l3-1z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  inventory: ['M4 7l8-4 8 4-8 4z', 'M4 7v10l8 4 8-4V7', 'M12 11v10'],
  banking: ['M3 9l9-5 9 5z', 'M5 9v9', 'M9 9v9', 'M15 9v9', 'M19 9v9', 'M4 18h16'],
  reports: ['M5 19V5h14v14z', 'M8 15v-4', 'M12 15V8', 'M16 15v-2'],
  admin: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v3', 'M12 19v3', 'M4.9 4.9 7 7', 'M19.1 19.1l-2.1-2.1', 'M22 12h-3', 'M5 12H2'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v3', 'M12 19v3', 'M4.9 4.9l2.1 2.1', 'M17 17l2.1 2.1', 'M22 12h-3', 'M5 12H2'],
  invoice: ['M7 3h9l3 3v15H7z', 'M16 3v4h4', 'M9 11h7', 'M9 15h7', 'M9 19h4'],
  document: ['M7 3h8l4 4v14H7z', 'M15 3v5h5', 'M9 12h6', 'M9 16h6'],
  delivery: ['M3 7h11v8H3z', 'M14 10h4l3 3v2h-7z', 'M7 18a2 2 0 1 0 0-.01', 'M17 18a2 2 0 1 0 0-.01'],
  receipt: ['M7 3h10v18l-2-1-2 1-2-1-2 1-2-1z', 'M9 8h6', 'M9 12h6', 'M9 16h4'],
  item: ['M5 5h6v6H5z', 'M13 5h6v6h-6z', 'M5 13h6v6H5z', 'M13 13h6v6h-6z'],
  partner: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M17 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M3 20a6 6 0 0 1 12 0', 'M14 20a5 5 0 0 1 7 0'],
  warehouse: ['M3 10l9-6 9 6v10H3z', 'M7 20v-7h10v7', 'M9 16h6'],
  price: ['M5 5h8l6 6-8 8-6-6z', 'M9 9h.01'],
  tax: ['M6 18 18 6', 'M7.5 8.5a2 2 0 1 0 0-.01', 'M16.5 17.5a2 2 0 1 0 0-.01'],
  uom: ['M4 17h16', 'M6 17V7', 'M18 17V7', 'M6 7h12', 'M9 11h6'],
  terms: ['M6 4h12v16H6z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  shipping: ['M4 8h16v8H4z', 'M8 8V5h8v3', 'M8 18a2 2 0 1 0 0-.01', 'M16 18a2 2 0 1 0 0-.01'],
  branch: ['M12 4v6', 'M6 14v6', 'M18 14v6', 'M6 14h12', 'M12 10l-6 4', 'M12 10l6 4'],
  accounts: ['M5 5h14v14H5z', 'M8 9h8', 'M8 13h8', 'M8 17h5'],
  bom: ['M12 3v5', 'M6 13v5', 'M18 13v5', 'M12 8l-6 5', 'M12 8l6 5', 'M4 18h4', 'M10 3h4', 'M16 18h4'],
  issue: ['M4 12h12', 'M12 8l4 4-4 4', 'M5 5h14v14'],
  transfer: ['M7 7h12', 'M15 3l4 4-4 4', 'M17 17H5', 'M9 13l-4 4 4 4'],
  payments: ['M4 7h16v10H4z', 'M4 10h16', 'M8 15h4'],
  report: ['M4 19h16', 'M7 16V9', 'M12 16V5', 'M17 16v-4'],
  default: ['M5 5h14v14H5z', 'M8 9h8', 'M8 13h8', 'M8 17h5'],
};

const inferIconKey = (menu) => {
  const icon = normalizeMenuPriorityName(menu?.icon);
  const name = normalizeMenuPriorityName(menu?.menuName);
  const path = normalizePath(menu?.menuPath || '');
  const lookup = `${icon} ${name} ${path}`.toLowerCase();

  if (icon && ICON_PATHS[icon]) return icon;
  if (lookup.includes('dashboard')) return 'dashboard';
  if (lookup.includes('sales')) return 'sales';
  if (lookup.includes('service')) return 'services';
  if (lookup.includes('purchase') || lookup.includes('purchasing') || lookup.includes('ap ')) return 'purchase';
  if (lookup.includes('master')) return 'master';
  if (lookup.includes('production')) return 'production';
  if (lookup.includes('inventory')) return 'inventory';
  if (lookup.includes('bank')) return 'banking';
  if (lookup.includes('report') || lookup.includes('analysis')) return 'reports';
  if (lookup.includes('setting')) return 'settings';
  if (lookup.includes('admin')) return 'admin';
  if (lookup.includes('invoice') || lookup.includes('credit memo')) return 'invoice';
  if (lookup.includes('quotation') || lookup.includes('order') || lookup.includes('request')) return 'document';
  if (lookup.includes('delivery')) return 'delivery';
  if (lookup.includes('receipt')) return 'receipt';
  if (lookup.includes('item')) return 'item';
  if (lookup.includes('business partner') || lookup.includes('partner')) return 'partner';
  if (lookup.includes('warehouse')) return 'warehouse';
  if (lookup.includes('price')) return 'price';
  if (lookup.includes('tax')) return 'tax';
  if (lookup.includes('uom')) return 'uom';
  if (lookup.includes('payment term')) return 'terms';
  if (lookup.includes('shipping')) return 'shipping';
  if (lookup.includes('branch')) return 'branch';
  if (lookup.includes('chart') || lookup.includes('account')) return 'accounts';
  if (lookup.includes('bill of material') || lookup.includes('bom')) return 'bom';
  if (lookup.includes('issue')) return 'issue';
  if (lookup.includes('transfer')) return 'transfer';
  if (lookup.includes('payment')) return 'payments';
  return 'default';
};

const SidebarIcon = ({ menu }) => {
  const paths = ICON_PATHS[inferIconKey(menu)] || ICON_PATHS.default;

  return (
    <svg className="sidebar__icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths.map((pathData, index) => (
        <path key={`${pathData}-${index}`} d={pathData} />
      ))}
    </svg>
  );
};

const isDashboardMenu = (menu) => {
  const menuPath = menu?.menuPath ? normalizePath(menu.menuPath) : '';
  return menuPath === DASHBOARD_PATH || normalizeMenuPriorityName(menu?.menuName) === 'dashboard';
};

const extractDashboardMenu = (menus = []) => {
  let dashboardMenu = null;

  const stripDashboard = (items) =>
    items.reduce((nextItems, item) => {
      const nextChildren = item.children?.length ? stripDashboard(item.children) : item.children;

      if (isDashboardMenu(item)) {
        if (!dashboardMenu) {
          dashboardMenu = {
            ...item,
            parentId: null,
            menuPath: DASHBOARD_PATH,
            children: [],
          };
        }
        return nextItems;
      }

      nextItems.push(
        nextChildren === item.children
          ? item
          : {
              ...item,
              children: nextChildren,
            },
      );
      return nextItems;
    }, []);

  return {
    dashboardMenu: dashboardMenu || STATIC_DASHBOARD_MENU,
    remainingMenus: stripDashboard(menus),
  };
};

const sortTopLevelMenus = (menus = []) =>
  [...menus].sort((a, b) => {
    const priorityA = TOP_LEVEL_MENU_PRIORITY.get(normalizeMenuPriorityName(a.menuName)) ?? Number.MAX_SAFE_INTEGER;
    const priorityB = TOP_LEVEL_MENU_PRIORITY.get(normalizeMenuPriorityName(b.menuName)) ?? Number.MAX_SAFE_INTEGER;

    if (priorityA !== priorityB) return priorityA - priorityB;
    if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return String(a.menuId).localeCompare(String(b.menuId), undefined, { numeric: true });
  });

const getSalesChildPriority = (menu) => {
  const menuPath = menu?.menuPath ? normalizePath(menu.menuPath) : '';
  return SALES_CHILD_PATH_PRIORITY.get(menuPath)
    ?? SALES_CHILD_PRIORITY.get(normalizeMenuPriorityName(menu?.menuName))
    ?? Number.MAX_SAFE_INTEGER;
};

const sortSalesMenuChildren = (items = [], parentMenu = null) => {
  const isSalesBranch = SALES_MENU_NAMES.has(normalizeMenuPriorityName(parentMenu?.menuName));
  const nextItems = items.map((item) => ({
    ...item,
    children: sortSalesMenuChildren(item.children || [], item),
  }));

  if (!isSalesBranch) {
    return nextItems;
  }

  return nextItems.sort((a, b) => {
    const priorityA = getSalesChildPriority(a);
    const priorityB = getSalesChildPriority(b);
    if (priorityA !== priorityB) return priorityA - priorityB;
    if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return String(a.menuId).localeCompare(String(b.menuId), undefined, { numeric: true });
  });
};

const flattenReportSidebarItems = (items = [], parentName = '') =>
  items.flatMap((item) => {
    const normalizedName = normalizeMenuPriorityName(item?.menuName);
    const normalizedParentName = normalizeMenuPriorityName(parentName);
    const children = flattenReportSidebarItems(item.children || [], item?.menuName);
    const isReportLayoutManagerWrapper = REPORT_STUDIO_NAMES.has(normalizedName);
    const isReportsWrapper = normalizedName === REPORTS_MENU_NAME;
    const isBusinessPartnerReportsWrapper =
      normalizedParentName === 'business partners' && BUSINESS_PARTNER_REPORT_WRAPPER_NAMES.has(normalizedName);

    if (
      children.length
      && (isReportLayoutManagerWrapper || isReportsWrapper || isBusinessPartnerReportsWrapper)
    ) {
      return children;
    }

    return [{
      ...item,
      children,
    }];
  });

const normalizeReportSidebarTree = (menus = []) =>
  menus.map((menu) => {
    if (normalizeMenuPriorityName(menu?.menuName) !== REPORTS_MENU_NAME) {
      return menu;
    }

    return {
      ...menu,
      children: flattenReportSidebarItems(menu.children || [], menu.menuName),
    };
  });

const mergeReportLayoutManagerIntoReports = (menus = []) => {
  const layoutManagerMenus = menus.filter((menu) =>
    REPORT_STUDIO_NAMES.has(normalizeMenuPriorityName(menu?.menuName)),
  );
  const remainingMenus = menus.filter((menu) =>
    !REPORT_STUDIO_NAMES.has(normalizeMenuPriorityName(menu?.menuName)),
  );
  const layoutChildren = layoutManagerMenus.flatMap((menu) =>
    flattenReportSidebarItems(menu.children || [], menu.menuName),
  );

  if (!layoutChildren.length) {
    return remainingMenus;
  }

  return remainingMenus.map((menu) => {
    if (normalizeMenuPriorityName(menu?.menuName) !== REPORTS_MENU_NAME) {
      return menu;
    }

    const existingKeys = new Set((menu.children || []).map((child) =>
      child.menuPath
        ? `path:${normalizePath(child.menuPath)}`
        : `name:${normalizeMenuPriorityName(child.menuName)}`,
    ));
    const nextChildren = [...(menu.children || [])];

    for (const child of layoutChildren) {
      const key = child.menuPath
        ? `path:${normalizePath(child.menuPath)}`
        : `name:${normalizeMenuPriorityName(child.menuName)}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        nextChildren.push(child);
      }
    }

    return {
      ...menu,
      children: nextChildren,
    };
  });
};

const buildSidebarMenus = (menus = []) => {
  const { dashboardMenu, remainingMenus } = extractDashboardMenu(menus);
  const mergedMenus = mergeReportSidebarRoots(remainingMenus);

  // Which pages a user sees is decided by Role Rights; the sidebar only drops
  // General Settings (opened from the admin area) and empty folders.
  const removeHiddenSidebarItems = (items = []) =>
    items.reduce((nextItems, item) => {
      const menuPath = item?.menuPath ? normalizePath(item.menuPath) : '';
      const filteredChildren = removeHiddenSidebarItems(item.children || []);

      if (menuPath === '/general-settings') {
        return nextItems;
      }

      if (!menuPath && !filteredChildren.length) {
        return nextItems;
      }

      nextItems.push({
        ...item,
        children: filteredChildren,
      });
      return nextItems;
    }, []);

  const visibleMenus = sortSalesMenuChildren(
    mergeReportLayoutManagerIntoReports(
      normalizeReportSidebarTree(removeHiddenSidebarItems(mergedMenus)),
    ),
  );
  return [
    dashboardMenu,
    ...sortTopLevelMenus(visibleMenus),
  ];
};

const hasActiveChild = (menu, pathname) => {
  const menuPath = menu.menuPath ? normalizePath(menu.menuPath) : '';
  if (menuPath && (pathname === menuPath || pathname.startsWith(`${menuPath}/`))) {
    return true;
  }

  return menu.children?.some((child) => hasActiveChild(child, pathname));
};

const getComparableTaskPath = (path = '') =>
  normalizePath(String(path || '').split(/[?#]/)[0]);

const flattenSidebarSearchItems = (items = [], parents = []) =>
  items.flatMap((item) => {
    const displayName = getDisplayMenuName(item);
    const menuPath = item.menuPath ? normalizePath(item.menuPath) : '';
    const trail = [...parents, displayName].filter(Boolean);
    const ownItem = menuPath
      ? [{
          menuId: item.menuId,
          menuName: displayName,
          menuPath,
          trail,
          searchText: `${displayName} ${menuPath} ${trail.join(' ')}`.toLowerCase(),
          iconMenu: item,
        }]
      : [];

    return [
      ...ownItem,
      ...flattenSidebarSearchItems(item.children || [], trail),
    ];
  });

const SidebarSearchResult = ({ item, onOpen }) => (
  <button
    type="button"
    className="sidebar__search-result"
    onClick={() => onOpen(item.menuPath)}
  >
    <span className="sidebar__search-result-icon" aria-hidden="true">
      <SidebarIcon menu={item.iconMenu} />
    </span>
    <span className="sidebar__search-result-body">
      <span className="sidebar__search-result-title">{item.menuName}</span>
      <span className="sidebar__search-result-path">{item.trail.join(' / ')}</span>
    </span>
  </button>
);

const SidebarMenuNode = ({ menu, collapsed, openState, setOpenState, pathname, onNavigate, depth = 0 }) => {
  const hasChildren = Boolean(menu.children?.length);
  const menuPath = menu.menuPath ? normalizePath(menu.menuPath) : '';
  const isOpen = openState[menu.menuId] ?? hasActiveChild(menu, pathname);
  const displayMenuName = getDisplayMenuName(menu);
  const isNested = depth > 0;

  if (hasChildren) {
    return (
      <div className="sidebar__section">
        <button
          type="button"
          className={`sidebar__section-toggle${isOpen ? ' is-open' : ''}${isNested ? ' sidebar__section-toggle--nested' : ''}`}
          onClick={() => setOpenState((current) => ({ ...current, [menu.menuId]: !isOpen }))}
          title={collapsed ? displayMenuName : undefined}
        >
          <span className="sidebar__section-icon" aria-hidden="true">
            <SidebarIcon menu={menu} />
          </span>
          {!collapsed ? (
            <span className="sidebar__section-title">{displayMenuName}</span>
          ) : null}
          {!collapsed ? (
            <span className={`sidebar__section-caret${isOpen ? ' is-open' : ''}`} aria-hidden="true">
              {'>'}
            </span>
          ) : null}
        </button>

        {isOpen ? (
          <div className={`sidebar__section-body${collapsed ? ' is-collapsed' : ''}`}>
            {menu.children.map((child) => (
              <SidebarMenuNode
                key={child.menuId}
                menu={child}
                collapsed={collapsed}
                openState={openState}
                setOpenState={setOpenState}
                pathname={pathname}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (!menuPath) {
    return null;
  }

  if (isAdminMenuPath(menuPath)) {
    return (
      <a
        href={menuPath}
        target="_blank"
        rel="noreferrer"
        className={`sidebar__link${isNested ? ' sidebar__link--nested' : ''}`}
        title={collapsed ? `${displayMenuName} (opens in new window)` : undefined}
      >
        <span className="sidebar__link-icon" aria-hidden="true">
          <SidebarIcon menu={menu} />
        </span>
        {!collapsed ? <span className="sidebar__link-text">{displayMenuName}</span> : null}
      </a>
    );
  }

  return (
    <NavLink
      to={menuPath}
      end={menuPath === DASHBOARD_PATH}
      onClick={(event) => onNavigate(event, menuPath)}
      className={({ isActive }) =>
        `sidebar__link${isActive ? ' sidebar__link--active' : ''}${isNested ? ' sidebar__link--nested' : ''}`
      }
      title={collapsed ? displayMenuName : undefined}
    >
      <span className="sidebar__link-icon" aria-hidden="true">
        <SidebarIcon menu={menu} />
      </span>
      {!collapsed ? <span className="sidebar__link-text">{displayMenuName}</span> : null}
    </NavLink>
  );
};

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { menus, company } = useAuth();
  const taskbar = useSapWindowTaskbar();
  const { restoreTask } = useSapWindowTaskbarActions();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [openState, setOpenState] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const pathname = normalizePath(location.pathname);

  const sidebarMenus = useMemo(
    () => buildSidebarMenus(menus),
    [menus],
  );
  const sidebarSearchItems = useMemo(
    () => flattenSidebarSearchItems(sidebarMenus),
    [sidebarMenus],
  );
  const normalizedSearchQuery = searchQuery.trim();
  const sidebarSearchResults = normalizedSearchQuery
    ? sidebarSearchItems
        .filter((item) => matchesSapSearchText(item.searchText, normalizedSearchQuery))
        .slice(0, 10)
    : [];

  const findExistingTaskForPath = (menuPath) => {
    const normalizedMenuPath = normalizePath(menuPath);
    return [...(taskbar?.tasks || [])]
      .reverse()
      .find((task) => getComparableTaskPath(task?.path) === normalizedMenuPath);
  };

  const restoreExistingTaskForPath = (menuPath) => {
    const matchingTask = findExistingTaskForPath(menuPath);
    if (!matchingTask) return false;
    return restoreTask(matchingTask);
  };

  const openNewWindowForExistingTask = (menuPath, matchingTask) => {
    if (!matchingTask || !supportsMultipleMenuWindows(menuPath)) return false;

    const routeState = createMenuWindowRouteState({
      path: menuPath,
      title: matchingTask.title || 'A/P Credit Memo',
      company,
    });
    restoreTargetWindowState(menuPath, routeState.sapWindow.id);
    navigate(menuPath, { state: routeState });
    return true;
  };

  const handleNavigate = (event, menuPath) => {
    if (!menuPath) return;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    const matchingTask = findExistingTaskForPath(menuPath);
    if (openNewWindowForExistingTask(menuPath, matchingTask)) {
      return;
    }
    if (restoreExistingTaskForPath(menuPath)) {
      return;
    }
    restoreTargetWindowState(menuPath);
    navigate(menuPath, { state: null });
  };

  const handleToggleCollapsed = () => {
    setCollapsed((current) => {
      const nextCollapsed = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(nextCollapsed));
      } catch {
        // Ignore storage errors; the visual toggle should still work.
      }
      return nextCollapsed;
    });
  };

  const openSearchResult = (menuPath) => {
    if (!menuPath) return;
    const normalizedPath = normalizePath(menuPath);
    if (isAdminMenuPath(normalizedPath)) {
      window.open(normalizedPath, '_blank', 'noopener,noreferrer');
    } else if (openNewWindowForExistingTask(normalizedPath, findExistingTaskForPath(normalizedPath))) {
      setSearchQuery('');
      return;
    } else if (restoreExistingTaskForPath(normalizedPath)) {
      setSearchQuery('');
      return;
    } else {
      restoreTargetWindowState(normalizedPath);
      navigate(normalizedPath, { state: null });
    }
    setSearchQuery('');
  };

  return (
    <aside className={`sidebar-shell${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar">
        <div className="sidebar__top">
          <div className="sidebar__brand">
            <div className="sidebar__brand-mark">SB</div>
            {!collapsed ? (
              <div>
                <div className="sidebar__brand-title">SAP Client</div>
                <div className="sidebar__brand-subtitle">Henny_Erp</div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="sidebar__collapse-btn"
            onClick={handleToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span aria-hidden="true">{collapsed ? '>' : '<'}</span>
          </button>
        </div>

        <div className="sidebar__content">
          {!collapsed ? (
            <div className="sidebar__search">
              <label className="sidebar__search-label" htmlFor="sidebar-menu-search">
                Menu Search
              </label>
              <div className="sidebar__search-field">
                <span className="sidebar__search-icon" aria-hidden="true">
                  <svg className="sidebar__icon-svg" viewBox="0 0 24 24" focusable="false">
                    <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
                    <path d="M16 16l5 5" />
                  </svg>
                </span>
                <input
                  id="sidebar-menu-search"
                  className="sidebar__search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && sidebarSearchResults[0]) {
                      event.preventDefault();
                      openSearchResult(sidebarSearchResults[0].menuPath);
                    }
                    if (event.key === 'Escape') {
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Search menu"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="sidebar__search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear menu search"
                    title="Clear"
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <nav className="sidebar__nav">
            {normalizedSearchQuery ? (
              sidebarSearchResults.length ? (
                <div className="sidebar__search-results" aria-label="Menu search results">
                  {sidebarSearchResults.map((item) => (
                    <SidebarSearchResult
                      key={`${item.menuId}-${item.menuPath}`}
                      item={item}
                      onOpen={openSearchResult}
                    />
                  ))}
                </div>
              ) : (
                <div className="sidebar__empty">
                  No matching menu found.
                </div>
              )
            ) : sidebarMenus.length ? (
              sidebarMenus.map((menu) => (
                <SidebarMenuNode
                  key={menu.menuId}
                  menu={menu}
                  collapsed={collapsed}
                  openState={openState}
                  setOpenState={setOpenState}
                  pathname={pathname}
                  onNavigate={handleNavigate}
                  depth={0}
                />
              ))
            ) : (
              <div className="sidebar__empty">
                No menus are available for this role.
              </div>
            )}
          </nav>
        </div>
      </div>
    </aside>
  );
}
