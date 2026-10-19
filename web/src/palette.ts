export const STICKY = ['#FFE47A', '#FFC3A0', '#B6EBC6', '#B9DCFF', '#D8C8FF', '#FFBDD0'];
export const FILLS = ['#FFFFFF', '#FFE47A', '#FFC3A0', '#B6EBC6', '#B9DCFF', '#D8C8FF'];
/** "ink" follows the theme so dark text never disappears on a dark board */
export const INKS = ['ink', '#2F5BFF', '#FF5A4E', '#12B5A6', '#E69500', '#8B5CF6'];
export const inkColor = (c?: string) => (!c || c === 'ink' ? 'var(--ink)' : c);

/** each person on a board gets one of these: their cursor, selection and name flag use it */
export const PEOPLE = ['#2F5BFF', '#FF5A4E', '#12B5A6', '#8B5CF6', '#E69500', '#E0457B'];
