import { useState, useEffect, useCallback, useMemo } from "react";
import { shareBaseOrigin } from "../services/share-origin";

export type AppRoute =
  | "welcome"
  | "editor"
  | "new"
  | "templates"
  | "recent"
  | "share"
  | "motion";

export interface RouteParams {
  dimensions?: string;
  preset?: string;
  width?: string;
  height?: string;
  fps?: string;
  tab?: string;
  shareId?: string;
  compositionId?: string;
}

export interface RouterState {
  route: AppRoute;
  params: RouteParams;
}

function parseHash(hash: string): RouterState {
  const cleanHash = hash.replace(/^#\/?/, "");
  const [path, queryString] = cleanHash.split("?");

  const params: RouteParams = {};
  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    searchParams.forEach((value, key) => {
      params[key as keyof RouteParams] = value;
    });
  }

  const pathParts = path.split("/");
  let route: AppRoute = (pathParts[0] || "welcome") as AppRoute;
  const validRoutes: AppRoute[] = [
    "welcome",
    "editor",
    "new",
    "templates",
    "recent",
    "share",
    "motion",
  ];

  if (route === "share" && pathParts[1]) {
    params.shareId = pathParts[1];
  }

  return {
    route: validRoutes.includes(route) ? route : "welcome",
    params,
  };
}

function buildHash(route: AppRoute, params?: RouteParams): string {
  let hash = `#/${route}`;

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      hash += `?${queryString}`;
    }
  }

  return hash;
}

export function useRouter() {
  const [state, setState] = useState<RouterState>(() => {
    if (typeof window !== "undefined") {
      return parseHash(window.location.hash);
    }
    return { route: "welcome", params: {} };
  });

  useEffect(() => {
    const handleHashChange = () => {
      setState(parseHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = useCallback((route: AppRoute, params?: RouteParams) => {
    const hash = buildHash(route, params);
    window.location.hash = hash;
  }, []);

  const updateParams = useCallback(
    (newParams: Partial<RouteParams>) => {
      const hash = buildHash(state.route, { ...state.params, ...newParams });
      window.location.hash = hash;
    },
    [state.route, state.params],
  );

  const clearParams = useCallback(() => {
    const hash = buildHash(state.route);
    window.location.hash = hash;
  }, [state.route]);

  const parsedDimensions = useMemo(() => {
    const { dimensions, width, height } = state.params;

    if (dimensions) {
      const match = dimensions.match(/^(\d+)x(\d+)$/i);
      if (match) {
        return {
          width: parseInt(match[1], 10),
          height: parseInt(match[2], 10),
        };
      }
    }

    if (width && height) {
      return { width: parseInt(width, 10), height: parseInt(height, 10) };
    }

    return null;
  }, [state.params]);

  const fps = useMemo(() => {
    const { fps } = state.params;
    if (fps) {
      const parsed = parseInt(fps, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 120) {
        return parsed;
      }
    }
    return 30;
  }, [state.params]);

  return {
    route: state.route,
    params: state.params,
    navigate,
    updateParams,
    clearParams,
    parsedDimensions,
    fps,
  };
}

export function generateShareableLink(
  route: AppRoute,
  params?: RouteParams,
): string {
  return `${shareBaseOrigin()}${buildHash(route, params)}`;
}

export function generateNewProjectLink(options: {
  width?: number;
  height?: number;
  preset?: string;
  fps?: number;
}): string {
  const params: RouteParams = {};

  if (options.preset) {
    params.preset = options.preset;
  } else if (options.width && options.height) {
    params.dimensions = `${options.width}x${options.height}`;
  }

  if (options.fps && options.fps !== 30) {
    params.fps = String(options.fps);
  }

  return generateShareableLink("new", params);
}
