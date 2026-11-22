import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RECENTS, pinFavorites, useFavoritesStore } from "./favorites-store";

describe("favorites store", () => {
  beforeEach(() => useFavoritesStore.setState({ favorites: {}, recents: {} }));

  it("toggles favourites per kind", () => {
    const { toggleFavorite } = useFavoritesStore.getState();
    toggleFavorite("font", "Inter");
    toggleFavorite("sfx", "whoosh");
    expect(useFavoritesStore.getState().favorites).toEqual({ font: ["Inter"], sfx: ["whoosh"] });
    toggleFavorite("font", "Inter");
    expect(useFavoritesStore.getState().favorites.font).toEqual([]);
  });

  it("keeps recents unique, newest first and bounded", () => {
    const { pushRecent } = useFavoritesStore.getState();
    for (let i = 0; i < MAX_RECENTS + 3; i++) pushRecent("font", `F${i}`);
    pushRecent("font", "F5");
    const recents = useFavoritesStore.getState().recents.font;
    expect(recents).toHaveLength(MAX_RECENTS);
    expect(recents[0]).toBe("F5");
    expect(new Set(recents).size).toBe(recents.length);
  });

  it("pins favourites first without reordering the rest", () => {
    expect(pinFavorites(["a", "b", "c", "d"], (x) => x, ["c", "a"])).toEqual(["a", "c", "b", "d"]);
    expect(pinFavorites(["a", "b"], (x) => x, [])).toEqual(["a", "b"]);
  });
});
