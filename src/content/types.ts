export interface Article {
  slug: string;            // url slug, kebab-case
  kind: "guide" | "post";  // guide → /guides/<slug>, post → /blog/<slug>
  title: string;
  description: string;     // meta description, ≤160 chars
  published: string;       // YYYY-MM-DD
  updated?: string;        // YYYY-MM-DD
  body: string;            // trusted HTML: h2, h3, p, ul, ol, li, a, strong, em, code, pre, blockquote, table/thead/tbody/tr/th/td, img
}
