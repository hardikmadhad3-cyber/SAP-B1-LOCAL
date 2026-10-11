import { normalizePath } from '../auth/routeUtils';

const normalizedName = (menu) => String(menu?.menuName || '').trim().toLowerCase();
const menuKey = (menu) => {
  const path = menu?.menuPath ? normalizePath(menu.menuPath) : '';
  return path ? `path:${path}` : `section:${normalizedName(menu)}`;
};

const mergeChildren = (first = [], second = []) => {
  const merged = [...first];
  const positions = new Map(merged.map((menu, index) => [menuKey(menu), index]));

  for (const menu of second) {
    const key = menuKey(menu);
    const index = positions.get(key);
    if (index === undefined) {
      positions.set(key, merged.length);
      merged.push(menu);
    } else {
      merged[index] = {
        ...merged[index],
        children: mergeChildren(merged[index].children || [], menu.children || []),
      };
    }
  }

  return merged;
};

// The old /reports menu and the code-owned Reports section can coexist in the
// auth database. Keep every visible child, but show only one sidebar section.
export const mergeReportSidebarRoots = (menus = []) => {
  const routedRoots = menus.filter((menu) => normalizePath(menu?.menuPath || '') === '/reports');
  if (!routedRoots.length) return menus;

  const sectionIndex = menus.findIndex((menu) =>
    normalizedName(menu) === 'reports' && !menu.menuPath);

  if (sectionIndex < 0) {
    const firstRoutedRoot = routedRoots[0];
    return menus.reduce((result, menu) => {
      if (menu === firstRoutedRoot) {
        result.push({
          ...menu,
          menuPath: '',
          children: routedRoots.reduce((children, root) => mergeChildren(children, root.children || []), []),
        });
      } else if (!routedRoots.includes(menu)) {
        result.push(menu);
      }
      return result;
    }, []);
  }

  return menus.reduce((result, menu, index) => {
    if (index === sectionIndex) {
      result.push({
        ...menu,
        children: routedRoots.reduce((children, root) => mergeChildren(children, root.children || []), menu.children || []),
      });
    } else if (!routedRoots.includes(menu)) {
      result.push(menu);
    }
    return result;
  }, []);
};
