/** Theme mapping: role + style token -> CSS classes defined in theme.css. Retheme = swap theme.css. */
export const ROLES = ['primary', 'secondary', 'danger', 'nav'] as const;
export const STYLES = ['ok', 'warn', 'bad'] as const;

export function themeClass(role: string, style?: string): string {
  const r = (ROLES as readonly string[]).includes(role) ? role : 'secondary';
  const s = style && (STYLES as readonly string[]).includes(style) ? ` eng-s-${style}` : '';
  return `eng-btn eng-r-${r}${s}`;
}
