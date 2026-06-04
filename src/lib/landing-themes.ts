// Theme-Registry: HTML/CSS/JS als raw Strings, damit sie im Server-Function-Bundle
// (Cloudflare Workers) verfügbar sind — kein FS-Zugriff zur Laufzeit.

import t02Html from "../landing-themes/theme-02/template.html?raw";
import t02Css from "../landing-themes/theme-02/style.css?raw";
import t02Js from "../landing-themes/theme-02/script.js?raw";
import t02Meta from "../landing-themes/theme-02/meta.json";

import t03Html from "../landing-themes/theme-03/template.html?raw";
import t03Css from "../landing-themes/theme-03/style.css?raw";
import t03Js from "../landing-themes/theme-03/script.js?raw";
import t03Meta from "../landing-themes/theme-03/meta.json";

import t04Html from "../landing-themes/theme-04/template.html?raw";
import t04Css from "../landing-themes/theme-04/style.css?raw";
import t04Js from "../landing-themes/theme-04/script.js?raw";
import t04Meta from "../landing-themes/theme-04/meta.json";

export type ThemeFiles = {
  id: string;
  name: string;
  description: string;
  html: string;
  css: string;
  js: string;
};

export const THEMES: ThemeFiles[] = [
  { id: t02Meta.id, name: t02Meta.name, description: t02Meta.description, html: t02Html, css: t02Css, js: t02Js },
  { id: t03Meta.id, name: t03Meta.name, description: t03Meta.description, html: t03Html, css: t03Css, js: t03Js },
  { id: t04Meta.id, name: t04Meta.name, description: t04Meta.description, html: t04Html, css: t04Css, js: t04Js },
];

export function getTheme(id: string): ThemeFiles | undefined {
  return THEMES.find((t) => t.id === id);
}

export const THEME_LIST = THEMES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
}));
