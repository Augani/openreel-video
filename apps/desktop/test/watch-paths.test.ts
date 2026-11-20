import path from "node:path";
import { describe, expect, it } from "vitest";
import { pathKey, samePath } from "../src/main/watch/paths";

describe("watch path identity", () => {
  it("treats Windows spellings of one folder as the same", () => {
    const w = path.win32;
    expect(samePath("C:\\Users\\Me\\Footage", "c:\\users\\me\\FOOTAGE", w)).toBe(true);
    expect(samePath("C:\\Users\\Me\\Footage", "C:/Users/Me/Footage/", w)).toBe(true);
    expect(samePath("C:\\Users\\Me\\Footage", "C:\\Users\\Me\\Other\\..\\Footage\\.", w)).toBe(true);
    expect(samePath("C:\\Users\\Me\\Footage", "C:\\Users\\Me\\Footage2", w)).toBe(false);
    expect(samePath("C:\\a", "D:\\a", w)).toBe(false);
  });

  it("keeps drive roots intact and strips only trailing separators below them", () => {
    expect(pathKey("C:\\", path.win32)).toBe("c:\\");
    expect(pathKey("C:\\a\\b\\\\", path.win32)).toBe("c:\\a\\b");
    expect(pathKey("/", path.posix)).toBe("/");
    expect(pathKey("/a/b/", path.posix)).toBe("/a/b");
  });

  it("stays case-sensitive on POSIX", () => {
    expect(samePath("/Media/Cards", "/media/cards", path.posix)).toBe(false);
    expect(samePath("/media/cards", "/media/./cards/", path.posix)).toBe(true);
  });
});
