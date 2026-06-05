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

import t05Html from "../landing-themes/theme-05/template.html?raw";
import t05Css from "../landing-themes/theme-05/style.css?raw";
import t05Js from "../landing-themes/theme-05/script.js?raw";
import t05Meta from "../landing-themes/theme-05/meta.json";

import t06Html from "../landing-themes/theme-06/template.html?raw";
import t06Css from "../landing-themes/theme-06/style.css?raw";
import t06Js from "../landing-themes/theme-06/script.js?raw";
import t06Meta from "../landing-themes/theme-06/meta.json";

import t07Html from "../landing-themes/theme-07/template.html?raw";
import t07Css from "../landing-themes/theme-07/style.css?raw";
import t07Js from "../landing-themes/theme-07/script.js?raw";
import t07Meta from "../landing-themes/theme-07/meta.json";

import t08Html from "../landing-themes/theme-08/template.html?raw";
import t08Css from "../landing-themes/theme-08/style.css?raw";
import t08Js from "../landing-themes/theme-08/script.js?raw";
import t08Meta from "../landing-themes/theme-08/meta.json";

import t09Html from "../landing-themes/theme-09/template.html?raw";
import t09Css from "../landing-themes/theme-09/style.css?raw";
import t09Js from "../landing-themes/theme-09/script.js?raw";
import t09Meta from "../landing-themes/theme-09/meta.json";

import t10Html from "../landing-themes/theme-10/template.html?raw";
import t10Css from "../landing-themes/theme-10/style.css?raw";
import t10Js from "../landing-themes/theme-10/script.js?raw";
import t10Meta from "../landing-themes/theme-10/meta.json";

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
  { id: t05Meta.id, name: t05Meta.name, description: t05Meta.description, html: t05Html, css: t05Css, js: t05Js },
  { id: t06Meta.id, name: t06Meta.name, description: t06Meta.description, html: t06Html, css: t06Css, js: t06Js },
  { id: t07Meta.id, name: t07Meta.name, description: t07Meta.description, html: t07Html, css: t07Css, js: t07Js },
  { id: t08Meta.id, name: t08Meta.name, description: t08Meta.description, html: t08Html, css: t08Css, js: t08Js },
  { id: t09Meta.id, name: t09Meta.name, description: t09Meta.description, html: t09Html, css: t09Css, js: t09Js },
  { id: t10Meta.id, name: t10Meta.name, description: t10Meta.description, html: t10Html, css: t10Css, js: t10Js },
];

export function getTheme(id: string): ThemeFiles | undefined {
  return THEMES.find((t) => t.id === id);
}

export const THEME_LIST = THEMES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
}));
