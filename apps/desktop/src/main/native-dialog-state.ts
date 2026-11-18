let openDialogs = 0;

export function isNativeDialogOpen(): boolean {
  return openDialogs > 0;
}

export async function withNativeDialog<T>(show: () => Promise<T>): Promise<T> {
  openDialogs += 1;
  try {
    return await show();
  } finally {
    openDialogs -= 1;
  }
}
