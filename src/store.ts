import fsSync from "node:fs";
import { LocalesSchema, type Locales } from "./types";

const storePath = "./node_modules/astro-i18n-routes/store.json";

const store = {
  set: (data: Locales) => {
    fsSync.writeFileSync(storePath, JSON.stringify(data, null, 2));
  },
  get: () => {
    const rawData = fsSync.readFileSync(storePath, "utf-8");
    const jsonData = JSON.parse(rawData);
    const parseResult = LocalesSchema.safeParse(jsonData);
    return parseResult.success ? parseResult.data : [];
  },
};

export default store;
