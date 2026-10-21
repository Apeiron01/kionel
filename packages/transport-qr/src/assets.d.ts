// Vite'ın ?url eki — paket, vite'ı bağımlılık olarak almadan tipini bilsin.
declare module "*?url" {
  const url: string;
  export default url;
}
