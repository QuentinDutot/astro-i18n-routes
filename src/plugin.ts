import fs from "node:fs";
import path from "node:path";
import type { AstroIntegration } from "astro";
import OpenAI from "openai";
import { z } from "zod";
import { LocaleSchema, type Locale, type Locales } from "./types";
import store from "./store";

const openai = new OpenAI({ apiKey: z.string().parse(process.env.OPENAI_KEY) });

const getDirectoryFiles = (dirPath: string) => {
  const entries = fs.readdirSync(dirPath);

  const files: string[] = [];

  for (const entry of entries) {
    const isDirectory = !path.extname(entry);

    if (isDirectory) {
      const nestedFiles = getDirectoryFiles(path.join(dirPath, entry));
      const cleanedFiles = nestedFiles.map(
        (nestedFile) => `${entry}/${nestedFile}`
      );
      files.push(...cleanedFiles);
    } else {
      files.push(entry);
    }
  }

  return files;
};

const getDirectoryTokens = (dirPath: string) => {
  const textRegex = /i18n\.text\(\s*["']([^"']+?)["']/gs;
  const pathRegex = /i18n\.path\(\s*["']([^"']+)["']\)/gs;

  const paths = new Set<string>();
  const texts = new Set<string>();

  const srcFiles = getDirectoryFiles(dirPath);

  srcFiles.forEach((srcFile) => {
    const rawData = fs.readFileSync(`${dirPath}/${srcFile}`, "utf-8");

    for (const match of rawData.matchAll(pathRegex)) {
      const path = match[1].slice(1, -1);
      if (path) paths.add(path);
    }

    for (const match of rawData.matchAll(textRegex)) {
      const text = match[1];
      if (text) texts.add(text);
    }
  });

  return { paths, texts };
};

const getPageTranslation = (path: string, translations: object) => {
  const [firstKey = "", ...otherKeys] = path.split("/");

  // if it's a nested path explore it recursively
  if (otherKeys.length > 0) {
    const firstTranslated = getPageTranslation(firstKey, translations);
    const otherTranslated = getPageTranslation(
      otherKeys.join("/"),
      translations[firstKey] ?? {}
    );
    return `${firstTranslated}/${otherTranslated}`;
  }

  let translated: string | object | undefined = translations[firstKey];

  if (typeof translated === "string") {
    return translated;
  }

  if (
    typeof translated === "object" &&
    "index" in translated &&
    typeof translated.index === "string"
  ) {
    return translated.index;
  }

  return path;
};

interface I18nIntegration {
  defaultLocale: Locale["code"];
  locales: { code: Locale["code"]; name: Locale["name"] }[];
  generate?: boolean;
  debug?: boolean;
}

const i18n = ({
  defaultLocale,
  locales,
  generate = false,
  debug = false,
}: I18nIntegration): AstroIntegration => {
  const consoleLog: typeof console.log = (...args) =>
    debug && console.log("[i18n]", ...args);

  return {
    name: "astro-i18n-routes",
    hooks: {
      "astro:config:setup": async ({ config, injectRoute }) => {
        consoleLog("Initializing...");
        // consoleLog('srcDir', config.srcDir)
        // consoleLog('trailingSlash', config.trailingSlash)

        if (!fs.existsSync("./public")) {
          fs.mkdirSync("./public");
        }
        if (!fs.existsSync("./public/locales")) {
          fs.mkdirSync("./public/locales");
        }

        const translatedLocales: Locales = [];
        if (generate) {
          consoleLog("Extracting paths/texs...");

          const { paths, texts } = getDirectoryTokens("./src");

          const generatedLocales = locales.map((locale) => ({
            ...locale,
            paths: Object.fromEntries([...paths].map((path) => [path, path])),
            texts: Object.fromEntries([...texts].map((text) => [text, text])),
          }));

          consoleLog("Translating paths/texts...");

          for (const generatedLocale of generatedLocales) {
            let parsedLocale = null;

            if (generatedLocale.code !== defaultLocale) {
              const result = await openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                  {
                    role: "system",
                    content: [
                      "You are an I18n tool that translates a user input.",
                      'Here is an example : { "code": "fr", name: "Français", "paths": { "dashboard": "dashboard" }, "texts": { "All accounts": "All accounts", "Add website": "Add website" } }.',
                      "Translate from english to the locale specified in the input.",
                      "Only translate the right hands of the paths and texts objects.",
                      '"paths" are slugs to will be used as pages slugs keep it url valid.',
                      "For the output, make sure to always respect the schema be valid json.",
                    ].join(" "),
                  },
                  {
                    role: "user",
                    content: JSON.stringify(generatedLocale, null, 2),
                  },
                ],
              });

              const translatedLocale = result.choices[0].message.content ?? "";

              try {
                parsedLocale = LocaleSchema.parse(JSON.parse(translatedLocale));
              } catch (error) {
                console.error(error);
              }
            }

            translatedLocales.push(parsedLocale ?? generatedLocale);
          }

          consoleLog("Saving translations...");
          translatedLocales.forEach((locale) => {
            fs.writeFileSync(
              `./public/locales/${locale.code}.json`,
              JSON.stringify(locale, null, 2)
            );
          });
        } else {
          consoleLog("Loading paths/texts...");

          const existingSources = getDirectoryFiles("./public/locales");

          existingSources.forEach((sourceFile) => {
            const rawSource = fs.readFileSync(
              `./public/locales/${sourceFile}`,
              "utf-8"
            );
            const parsedSource = JSON.parse(rawSource);
            translatedLocales.push(parsedSource);
          });
        }

        store.set(translatedLocales);
        consoleLog("Locales stored", translatedLocales);

        const allFiles = getDirectoryFiles("./src/routes");
        consoleLog("Files detected", allFiles);

        const rootFiles = allFiles.filter(
          (filePath) => !filePath.includes("[locale]")
        );
        const i18nFiles = allFiles.filter((filePath) =>
          filePath.includes("[locale]")
        );

        rootFiles.forEach((filePath) => {
          const fileWithoutExtension = filePath.replace(
            path.extname(filePath),
            ""
          );
          const fileWithoutIndex = fileWithoutExtension
            .replace("/index", "")
            .replace("index", "");
          // consoleLog('Original', fileWithoutIndex)

          injectRoute({
            pattern: fileWithoutIndex,
            entryPoint: `./src/routes/${filePath}`,
          });
          consoleLog("Route injected", fileWithoutIndex);
        });

        i18nFiles.forEach((filePath) => {
          const fileWithoutExtension = filePath
            .replace(path.extname(filePath), "")
            .replace("[locale]/", "");
          const fileWithoutIndex = fileWithoutExtension
            .replace("/index", "")
            .replace("index", "");
          // consoleLog('Original', fileWithoutIndex)

          translatedLocales.forEach((locale) => {
            const pageTranslation = getPageTranslation(
              fileWithoutIndex,
              locale.paths
            );
            // consoleLog('Translated', pageTranslation)

            let pathWithLocale = `/${locale.code}/`;
            if (pageTranslation) pathWithLocale += pageTranslation;
            if (pageTranslation && !pageTranslation.includes("."))
              pathWithLocale += "/";

            injectRoute({
              pattern: pathWithLocale,
              entryPoint: `./src/routes/${filePath}`,
            });
            consoleLog("Route injected", pathWithLocale);
          });
        });

        // const watcher = chokidar.watch(pagesI18nDir, { ignoreInitial: true })

        // watcher.on('change', async (filePath) => {
        //   consoleLog('File changed', filePath)
        //   consoleLog('🔍', 'Refresh the page in browser to see the changes. No HMR support yet.')
        // })

        // watcher.on('add', async (filePath) => {
        //   consoleLog('File added', filePath)
        //   consoleLog('🚧', 'Restart needed to rescan files.')
        //   process.exit(1)
        // })

        // watcher.on('unlink', async (filePath) => {
        //   consoleLog('File deleted', filePath)
        //   consoleLog('🚧', 'Restart needed to rescan files.')
        //   process.exit(1)
        // })
      },
    },
  };
};

export default i18n;
