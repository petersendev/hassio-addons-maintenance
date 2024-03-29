import * as fs from "fs-extra-promise";
import * as path from "path";
import * as request from "request-promise";
import chalk from "chalk";
import simpleGit, { SimpleGit, SimpleGitOptions, ResetMode } from 'simple-git';
import * as moment from "moment";
import * as readline from "readline";

import * as semver from "semver";
import { Manager } from "../manager";

export async function update(manager: Manager, opts: { patch: boolean, noGit: boolean })
{
    let useGit = !opts.noGit;

    let first = true;
    let updated = false;

    // always setup git
    const gitOptions: SimpleGitOptions = {
        baseDir: manager.rootDir,
        binary: "git",
        maxConcurrentProcesses: 1
    };

    const git = simpleGit(gitOptions);
    const branch = `updates-${moment().format("YYYY-MM-DD")}`;

    // perform git actions only if flag is set
    if (useGit)
    {
        // make sure we are on master and up to date
        await git.checkout("master");
        await git.pull();

        await cleanUpLocalBranches(git, true);

        // create branch for this update
        await git.checkoutLocalBranch(branch);

        // reset in case of local changes
        await git.reset(ResetMode.HARD);
    }

    for (const addon of await manager.getAddonDirs())
    {
        let appRelease = false;
        if (!first)
        {
            console.log(chalk.gray("============================================================="));
        }
        else
        {
            first = false;
        }

        const configPath = manager.getConfigPath(addon);
        const buildJsonPath = manager.getBuildJsonPath(addon);

        if (!(await fs.existsAsync(configPath)))
        {
            console.log(chalk.redBright(`no config found for addon ${chalk.blue(addon)}, skipping`));
            continue;
        }

        const config = await fs.readJSONAsync(configPath);
        let version = semver.valid(config.version);
        if (!version)
        {
            console.log(chalk.redBright(`version format for addon ${chalk.blue(addon)} not supported: ${config.version}`));
            continue;
        }

        console.log(`loaded ${chalk.blue(addon)} ${chalk.cyanBright(version)}`);

        if (!config.maintenance || !config.maintenance.github_release)
        {
            console.log(chalk.yellow("no valid maintenance section found, skipping"));
            continue;
        }

        const versionRegex = config.maintenance.version_regex ? new RegExp(config.maintenance.version_regex) : null;
        const releaseRegex = config.maintenance.release_regex ? new RegExp(config.maintenance.release_regex) : null;

        const addonPath = manager.getAddonPath(addon);
        const dockerFilePath = path.join(addonPath, "Dockerfile");

        let image: string;
        let tag: string;
        let dockerFile: string;

        const build_json = (await fs.existsAsync(buildJsonPath)) ? await fs.readJSONAsync(buildJsonPath) : null;

        if (!build_json)
        {
            dockerFile = (await fs.readFileAsync(dockerFilePath)).toString();
            const dockerBaseImageLine = dockerFile.split("\n")[0];
            const parts = dockerBaseImageLine.split(":");
            image = parts[0].replace("FROM ", "");
            tag = parts[1];
        }
        else
        {
            if (build_json.build_from_template)
            {
                image = build_json.build_from_template.image;
                tag = build_json.build_from_template.version;
            }
            else
            {
                appRelease = true;
                tag = build_json.args.RELEASE;
            }
        }

        const releaseInfo = config.maintenance.include_prerelease ?
            (await request({
                uri: `${config.maintenance.github_release.replace("github.com", "api.github.com/repos")}/releases`,
                headers: {
                    "User-Agent": "ham"
                },
                json: true
            }))[0] :
            await request({
                uri: `${config.maintenance.github_release}/releases/latest`,
                json: true
            });

        let coloredTag = tag;
        let appVersion = "";
        if (versionRegex)
        {
            const r = versionRegex.exec(tag);
            if (r && r.length > 1)
            {
                appVersion = r[1];
                coloredTag = tag.replace(appVersion, chalk.yellowBright(appVersion));
            }
        }

        if (releaseRegex)
        {
            const r = releaseRegex.exec(releaseInfo.tag_name);
            if (r && r.length > 1)
            {
                releaseInfo.tag_name = r[1];
            }
        }

        if (tag == releaseInfo.tag_name)
        {
            //TODO: different output for build.json usage
            console.log(chalk.greenBright(`base ${appRelease ? "application " : `image ${image}:`}${chalk.magenta(coloredTag)} is up-to-date`))
        }
        else
        {
            let newAppVersion = "";
            let newColoredTag = releaseInfo.tag_name;
            if (versionRegex)
            {
                const nr = versionRegex.exec(releaseInfo.tag_name);
                if (nr && nr.length > 1)
                {
                    newAppVersion = nr[1];
                    newColoredTag = newColoredTag.replace(newAppVersion, chalk.yellowBright(newAppVersion));
                }
            }

            let minorUpgrade = appVersion && newAppVersion && appVersion != newAppVersion;

            if (!opts.patch && !minorUpgrade)
            {
                console.log(chalk.gray(`ignoring patch for ${image}:${chalk.magenta(coloredTag)} to ${image}:${chalk.magenta(newColoredTag)}`))
            }
            else
            {
                if (!build_json)
                {
                    console.log(chalk.yellowBright(`updating base image from ${image}:${chalk.magenta(coloredTag)} to ${image}:${chalk.magenta(newColoredTag)}`));
                    await fs.writeFileAsync(dockerFilePath, dockerFile.replace(`${image}:${tag}`, `${image}:${releaseInfo.tag_name}`));
                }
                else
                {
                    if (appRelease)
                    {
                        console.log(chalk.yellowBright(`updating application release in build.json from ${chalk.magenta(coloredTag)} to ${chalk.magenta(newColoredTag)}`));
                        build_json.args.RELEASE = releaseInfo.tag_name;
                    }
                    else
                    {
                        console.log(chalk.yellowBright(`updating base images in build.json from ${image}:{arch}-${chalk.magenta(coloredTag)} to ${image}:{arch}-${chalk.magenta(newColoredTag)}`));
                        build_json.build_from_template.version = releaseInfo.tag_name;
                        for (let arch in build_json.build_from)
                        {
                            build_json.build_from[arch] = build_json.build_from[arch].replace(tag, releaseInfo.tag_name);
                        }
                    }
                    await fs.writeJSONAsync(buildJsonPath, build_json, { spaces: 4 });
                }

                const newVersion = semver.inc(version, minorUpgrade ? "minor" : "patch");
                console.log(chalk.yellow(`bumping version from ${chalk.cyanBright(version)} to ${chalk.cyanBright(newVersion)}`));
                config.version = newVersion;
                await fs.writeJSONAsync(configPath, config);

                // await manager.appendChangelog(addon, `## ${newVersion}\n\n - ${minorUpgrade ?
                //     `Update ${config.name} to ${newAppVersion} (${image}:${releaseInfo.tag_name})` :
                //     `Update base image to ${image}:${releaseInfo.tag_name}`}`);

                const msg = appRelease ? `Update ${config.name} to ${newAppVersion} (${releaseInfo.tag_name})` :
                    (minorUpgrade ?
                        `Update ${config.name} to ${newAppVersion} (${image}:${releaseInfo.tag_name})` :
                        `Update base image to ${image}:${releaseInfo.tag_name}`);

                await manager.appendChangelog(addon, newVersion, msg);

                if (useGit)
                {
                    await git.add(`${addon}/*`);
                    await git.commit(msg);
                }

                updated = true;
            }
        }
    }

    if (useGit)
    {
        if (!updated)
        {
            logGitAction("no addons updated, cleaning up git");
            await cleanUpLocalBranches(git, false);
        }
        else
        {
            const gitLog = (await git.log({ from: "master", to: branch })).all.map(x => x.message);
            const ans = await userInput(`\n\t${gitLog.join("\n\t")}\n\npush these changes? [Yn]: `);

            if (ans.toLowerCase() == "y" || ans == "")
            {
                await git.push("origin", branch, ["-u"]);
                logGitAction(`pushed branch ${branch}`);
            }
        }
    }
};

async function cleanUpLocalBranches(git: SimpleGit, force: boolean)
{
    // clean up local branches
    let branches = (await git.branchLocal()).all.filter(b => b.startsWith("updates"));

    if (branches && branches.length)
    {
        logGitAction(`deleting local branches: ${branches.join(", ")}`);
        await git.deleteLocalBranches(branches, force);
    }
}

function logGitAction(text: string)
{
    console.log(chalk.cyan(text));
}

function userInput(query: string): Promise<string>
{
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, (ans: string) =>
    {
        rl.close();
        resolve(ans);
    }));
}