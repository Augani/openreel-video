/**
 * Hawsh Khalifa integration ("Director's Eyes" library inside the editor).
 * The editor is opened from https://hawsh-khalifa.com/tools/director/editor with a one-time sign-in
 * code (#hk=…&pk=…). With it the editor gets its own Supabase session for the same project and can
 * read the user's generations/references and save exports to "My references". Without it the editor
 * works exactly as before.
 */
export const HAWSH_SUPABASE_URL = "https://dlqwvovmllggneslyuuz.supabase.co";
export const HAWSH_EDITOR_PAGE = "https://hawsh-khalifa.com/tools/director/editor";
/** Private bucket of the user's references (uploads). Insert policy: `{uid}/<file>.{jpg,png,webp,mp4,mov}`. */
export const HAWSH_REF_BUCKET = "director-refs";
/** director-refs bucket file size limit. */
export const HAWSH_LIBRARY_MAX_BYTES = 100 * 1024 * 1024;
export const HAWSH_PAGE_SIZE = 40;
