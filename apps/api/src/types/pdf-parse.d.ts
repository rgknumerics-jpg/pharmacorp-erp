// pdf-parse n'a pas de types ; on importe directement lib/pdf-parse.js (l'index lance un test de debogage).
declare module 'pdf-parse/lib/pdf-parse.js' {
  const parse: (data: Buffer) => Promise<{ text: string; numpages: number }>;
  export default parse;
}
