/** Browser origins allowed to call the API (CORS) and to open collaboration sockets. */
export function isAllowedOrigin(origin: string): boolean {
  return (
    /^http:\/\/localhost:\d+$/.test(origin) ||
    /\.openreel-studio\.pages\.dev$/.test(origin) ||
    origin === 'https://openreel-studio.pages.dev' ||
    /\.openreel\.video$/.test(origin) ||
    origin === 'https://app.openreel.video' ||
    origin === 'https://studio.openreel.video'
  );
}
