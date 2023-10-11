import negotiator from "negotiator";
import { match } from "@formatjs/intl-localematcher";
import store from "./store";

export const getLocalesCodes = () => store.get().map((locale) => locale.code);

export const matchLocale = (input: string) => {
  const headers: negotiator.Headers = { "accept-language": input };
  const languages = new negotiator({ headers }).languages();
  const matchedLocale = match(
    languages,
    getLocalesCodes(),
    getLocalesCodes()[0]
  );
  return matchedLocale;
};

export const getLocaleCodeFromUrl = (url: URL) => {
  const [localeCode] = url.pathname.split("/").filter(Boolean);
  const doesItExist = getLocalesCodes().includes(localeCode);
  return doesItExist ? localeCode : undefined;
};

export const getLocaleDataFromUrl = (url: URL) => {
  const [localeCode] = url.pathname.split("/").filter(Boolean);
  const matchedLocale = store
    .get()
    .find((locale) => locale.code === localeCode);
  return matchedLocale;
};

export const getPagesByLocaleCode = (localeCode: string) => {
  const matchedLocale = store
    .get()
    .find((locale) => locale.code === localeCode);
  return matchedLocale
    ? [
        `/${matchedLocale.code}/`,
        ...Object.values(matchedLocale.paths).map(
          (page) => `/${matchedLocale.code}/${page}/`
        ),
      ]
    : undefined;
};
