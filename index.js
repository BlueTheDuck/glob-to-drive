const core = require("@actions/core");
const { google } = require("googleapis");
const fs = require("fs");
const glob = require("glob");

/**
 * These are the scopes. The full list is here: https://developers.google.com/identity/protocols/oauth2/scopes#drive
 * The scopes tell Google what does your app want to do. Using a feature without declaring it here will fail
 * Remember to recreate the refresh token each time the scopes are changed
 * */
const SCOPES = require("./scopes.json");

//#region GApi
async function login() {
    try {
        /**
         * Get info required to perform the auth from the inputs vars
         * credentials is a JSON value downloaded from the Google Console OAuth
         * token can ve generated running `node login.js`. The file `token.json` will then contain the value
         * UPLOAD THIS VALUES AS SECRETS! NEVER KEEP THEM UNENCRYPTED
         */
        const credentials = JSON.parse(core.getInput("credentials", { required: true }));
        const token = JSON.parse(core.getInput("token", { required: true }));
        let auth = new google.auth.OAuth2(
            credentials.web.client_id,
            credentials.web.client_secret,
            credentials.web.redirect_uris[0]
        )
        auth.setCredentials(token);
        core.info("Auth successful");
        return auth;
    } catch (e) {
        return Promise.reject(e);
    }
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 */
async function list(drive, q) {
    let files = [];
    let pageToken = undefined;
    do {
        let res = await drive.files.list({
            pageSize: 10,
            q,
            pageToken
        });
        for (const file of res.data.files) {
            files.push(file);
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken !== undefined);
    await Promise.all(files.map(async file => {
        const { data } = await drive.files.get({ fileId: file.id, fields: "appProperties" });
        file.appProperties = data.appProperties;
    }))

    return files;
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 * @param {object} options
 * @param options.file File to get the content from
 * @param options.name Name of the file in Drive. Defaults to `file` if left empty
 * @param options.mimeType Mimetype (Used both for media: and requestBody:)
 * @param options.parents Parent folder. If empty, the file will be uploaded to My Drive
 */
async function upload(drive, options) {
    // Patch parents, it has to be an array
    if (!options.parents) {
        options.parents = [];
    } else if (typeof options.parents === 'string') {
        options.parents = [options.parents]
    }
    core.info(`Uploading file ${options.file} with mime-type ${options.mimeType}`);
    try {
        await drive.files.create({
            requestBody: {
                mimeType: options.mimeType,
                name: options.name || options.file,
                parents: options.parents,
                appProperties: {
                    source: options.file
                }
            },
            media: {
                mimeType: options.mimeType,
                body: fs.createReadStream(options.file)
            }
        });
    } catch (e) {
        return Promise.reject(e);
    }
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 * @param {object} options
 * @param {string} options.fileId
 * @param options.file File to get the content from
 */
async function update(drive, options) {
    core.info(`Updating ${options.file}`);
    await drive.files.update({
        fileId: options.fileId,
        media: {
            body: fs.createReadStream(options.file)
        }
    })
}
//#endregion

//#region Helpers
async function getGDriveFiles() {
    let q = "";
    // List files not trashed
    q += "trashed = false";
    // Append parent folder
    if (core.getInput("uploadTo"))
        q += ` and '${core.getInput("uploadTo")}' in parents`;
    // Download the list of files (names and ids) that currently exists on GDrive
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

let Drive = null;
login() // Perform auth
    .then((auth) => {
        // Create the Drive API and store it in the global var `drive`
        Drive = google.drive({
            version: "v3",
            auth: auth,
        });
    })
    .then(async _ => {
        let [gfiles, matches] = await Promise.all([getGDriveFiles(), getMatchedFiles()]);
        return Promise.all(matches.map(async (file) => {
            core.info(`Processing ${file}`);

            // Find if this file already exists on GDrive
            let gfile = gfiles.find(f => f.appProperties.source == file);

            // If it does, then we update its content
            if (gfile) {
                await update(Drive, {
                    fileId: gfile.id,
                    file
                }).then(_ => core.info(`${file} successfully updated`));
            } else {
                await upload(Drive, {
                    file,
                    name: file.substr(file.search("/") + 1),
                    mimeType: core.getInput("mimeType") || "plain/text",
                    parents: core.getInput("uploadTo")
                }).then(_ => core.info(`${file} successfully uploaded`));
            }
        })).then(p => p.length);
    })
    .then(res => {
        core.info(`${res} files uploaded/updated`);
    })
    .catch(core.setFailed);