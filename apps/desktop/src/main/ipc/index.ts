import { ipcMain } from "electron";
import { z } from "zod";

export function handle<TSchema extends z.ZodTypeAny, TResult>(
  channel: string,
  schema: TSchema,
  fn: (args: z.output<TSchema>) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, async (_event, raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`[ipc] invalid payload for ${channel}: ${parsed.error.message}`);
    }
    return fn(parsed.data);
  });
}
