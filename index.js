const { google } = require("googleapis");
const core = require("@actions/core");
const glob = require("glob");
const path = require("path");
const util = require("util");
const { login, createDriveApi, list, update, upload, folder } = require("./drive-wrapper.js");



/**
 * These are the scopes. The full list is here: https://developers.google.com/identity/protocols/oauth2/scopes#drive
 * The scopes tell Google what does your app want to do. Using a feature without declaring it here will fail
 * Remember to recreate the refresh token each time the scopes are changed
 * */
const SCOPES = require("./scopes.json");

//#region Helpers
/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 */
async function getGDriveFiles(Drive) {
    let q = "";
    // List files not trashed
    q += "trashed = false ";
    // Only list files created by glob-to-drive
    q += "and appProperties has { key='glob-to-drive' and value='true'}"

    // Download the list of files (names and ids) that currently exists on GDrive
    core.info("Getting list of files in Drive");
    return await list(Drive, q);
}

async function getMatchedFiles() {
    let pattern = core.getInput("glob", { required: true });
    core.info(`Performing search with ${pattern}`);
    let glob_p = util.promisify(glob);
    return glob_p(pattern, {
        "nodir": "true"
    });
}

/**
 * 
 * @param {String} filePath File to be uploaded
 * @param {Array<String>} gfiles Files found on Google Drive
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 */
async function processFile(filePath, gfiles, drive) {
    filePath = path.normalize(filePath);
    core.info(`Processing '${filePath}'`);

    // Find if this file already exists on GDrive
    // We may have grabbed a file without appProperties, so we should check that it exists
    let gfile = gfiles.find(f => f.appProperties && f.appProperties.source == filePath);

    // If it does, then we update its content
    if (gfile) {
        await update(drive, {
            fileId: gfile.id,
            file: filePath
        }).then(_ => core.info(`${filePath} successfully updated`));
    } else {
        let pathParsed = path.parse(filePath);
        // Folder to upload
        let folderId;
        // Also create subfolders
        let keepStructure = core.getInput("keepStructure") == "true" || core.getInput("keepStructure") == "";
        if (keepStructure) {
            folderId = await folder(drive, {
                create: true,
                parent: core.getInput("uploadTo"),
                path: pathParsed.dir
            });
        } else {
            folderId = core.getInput("uploadTo") || "root";
        }

        core.info(`Uploading '${pathParsed.dir}/${pathParsed.name}' to '${folderId}'`)

        await upload(drive, {
            path: filePath,
            name: pathParsed.base,
            mimeType: core.getInput("mimeType"),
            parents: [folderId]
        }).then(_ => core.info(`${filePath} successfully uploaded`));
    }
}
//#endregion

async function main() {
    let credentials, token;
    try {
        credentials = JSON.parse(core.getInput("credentials", { required: true }));
        token = JSON.parse(core.getInput("token", { required: true }));
    } catch (e) {
        core.error(`Failed to gather credentials: ${e}`);
        throw e;
    }
    core.info("Logging in");
    let auth = await login(credentials, token);
    let drive = createDriveApi(auth);
    let [gfiles, matches] = await Promise.all([getGDriveFiles(drive), getMatchedFiles()]);
    return await Promise.all(
        matches
            .map(
                filePath => processFile(filePath, gfiles, drive)
            ))
        .then(p => p.length); // Return the amount of files processed
}


main()
    .then(res => {
        core.info(`${res} files uploaded/updated`);
    })
    .catch(core.setFailed);