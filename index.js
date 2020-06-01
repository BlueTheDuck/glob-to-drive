const { google } = require("googleapis");
const core = require("@actions/core");
const glob = require("glob");
const path = require("path");
const { login, createDriveApi, list, update, upload } = require("./drive-wrapper.js");


/**
 * These are the scopes. The full list is here: https://developers.google.com/identity/protocols/oauth2/scopes#drive
 * The scopes tell Google what does your app want to do. Using a feature without declaring it here will fail
 * Remember to recreate the refresh token each time the scopes are changed
 * */
const SCOPES = require("./scopes.json");

let Drive = null;

//#region Helpers
/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 */
async function getGDriveFiles(Drive) {
    let q = "";
    // List files not trashed
    q += "trashed = false";
    // Append parent folder
    if (core.getInput("uploadTo"))
        q += ` and '${core.getInput("uploadTo")}' in parents`;

    // Download the list of files (names and ids) that currently exists on GDrive
    core.info("Getting list of files in Drive");
    return await list(Drive, q);
}
async function getMatchedFiles() {
    let pattern;
    try {
        pattern = core.getInput("glob", { required: true });
    } catch (e) {
        return nok(e);
    }
    core.info(`Performing search with ${pattern}`);
    return new Promise((ok, nok) => {
        glob(pattern, {}, (err, matches) => {
            if (err)
                return nok(err);
            else
                return ok(matches);
        })
    });
}
//#endregion

async function main() {
    // Try to get the login info as Action Inputs
    try {
        const credentials = JSON.parse(core.getInput("credentials", { required: true }));
        const token = JSON.parse(core.getInput("token", { required: true }));
        return [credentials, token];
    } catch (e) {
        return Promise.reject(e);
    }
}

main()
    // Perform auth
    .then(([credentials, token]) => login(credentials, token))
    .then(auth => {
        // Drive is the API, set as a global var
        Drive = createDriveApi(auth);
    })
    // Find get GDrive info and find files
    .then(_ => Promise.all([getGDriveFiles(Drive), getMatchedFiles()]))
    // Perform the upload/update
    .then(([gfiles, matches]) =>
        Promise.all(matches.map(async (filePath) => {
            filePath = path.normalize(filePath);
            core.info(`Processing ${filePath}`);

            // Find if this file already exists on GDrive
            let gfile = gfiles.find(f => f.appProperties.source == filePath);

            // If it does, then we update its content
            if (gfile) {
                await update(Drive, {
                    fileId: gfile.id,
                    file: filePath
                }).then(_ => core.info(`${filePath} successfully updated`));
            } else {
                let name = path.parse(filePath).base;
                await upload(Drive, {
                    path: filePath,
                    name,
                    mimeType: core.getInput("mimeType"),
                    parents: core.getInput("uploadTo")
                }).then(_ => core.info(`${filePath} successfully uploaded`));
            }
        })).then(p => p.length)// Return the amount of files processed
    )
    .then(res => {
        core.info(`${res} files uploaded/updated`);
    })
    .catch(core.setFailed);