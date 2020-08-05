import * as path from "path";
import * as spawn from "cross-spawn";
import * as fs from "fs-extra-promise";
import { Manager } from "../manager";

export async function docs(manager: Manager, opts: any)
{
    const addons = await manager.getAddonDirs();
    const mainReadme = (await fs.readFileAsync(manager.getMainReadmePath())).toString();

    let addonListItems = [];

    for await (const addon of addons)
    {
        const cfg = await manager.getAddonConfig(addon);
        addonListItems.push(`### [${addon}](${addon}/)\n${cfg.description}\n`);
    };

    const start = mainReadme.indexOf("[//]: # (ADDONLIST_START)") + 25
    const end = mainReadme.indexOf("[//]: # (ADDONLIST_END)");

    let newReadme = mainReadme.substring(0, start)
        .concat("\n").concat("\n")
        .concat(addonListItems.join("\n"))
        .concat("\n")
        .concat(mainReadme.substring(end));

    await fs.writeFileAsync(manager.getMainReadmePath(), newReadme);
}