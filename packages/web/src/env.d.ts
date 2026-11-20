declare module "*.css";
declare module "tabler-icons-data/*.json" {
  const value: unknown;
  export default value;
}

declare module "*?url" {
  const url: string;
  export default url;
}
