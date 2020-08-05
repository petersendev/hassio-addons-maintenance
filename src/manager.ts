import * as fs from "fs-extra-promise";
import * as path from "path";

export class Manager
{
    public rootDir = process.cwd();
    public tmpDir = "tmp";

    async getAddonDirs(): Promise<string[]>
    {
        let dirs = await fs.readdirAsync(this.rootDir);

        return dirs.filter((source) => !source.startsWith(".") && source != this.tmpDir && (fs.lstatSync(path.join(this.rootDir, source))).isDirectory());
    }

    getAddonPath(addon: string)
    {
        return path.join(this.rootDir, addon);
    }

    async getAddonConfig(addon: string)
    {
        return await fs.readJSONAsync(this.getConfigPath(addon));
    }

    getAddonTmpPath(addon: string)
    {
        return path.join(this.rootDir, this.tmpDir, addon);
    }

    getConfigPath(addon: string)
    {
        return path.join(this.getAddonPath(addon), "config.json");
    }

    getBuildJsonPath(addon: string)
    {
        return path.join(this.getAddonPath(addon), "build.json");
    }

    getChangelogPath(addon: string)
    {
        return path.join(this.getAddonPath(addon), "CHANGELOG.md");
    }

    getMainReadmePath()
    {
        return path.join(this.rootDir, "README.md");
    }

    async appendChangelog(addon: string, version: string, content: string | string[])
    {
        if (!Array.isArray(content))
        {
            content = [content];
        }

        const changelogPath = this.getChangelogPath(addon);

        let oldChangelog = "";

        if (await fs.existsAsync(changelogPath))
        {
            oldChangelog = (await fs.readFileAsync(changelogPath)).toString();
        }

        let changelog = `## ${version}\n\n`;
        content.forEach(line =>
        {
            changelog += ` - ${line}\n`;
        });

        if (oldChangelog)
        {
            changelog += `\n${oldChangelog}`;
        }

        await fs.writeFileAsync(changelogPath, changelog);
    }
}