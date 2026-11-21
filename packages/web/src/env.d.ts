declare module "*.css";
declare module "tabler-icons-data/*.json" {
  const value: unknown;
  export default value;
}

declare module "*?url" {
  const url: string;
  export default url;
}

/** Vite'ın derleme sırasında yerleştirdiği taban yol: masaüstünde "/", web sürümünde "/app/". */
interface ImportMeta {
  readonly env: { readonly BASE_URL: string };
}
