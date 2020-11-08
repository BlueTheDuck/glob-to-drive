const { google } = require("googleapis");
const core = require("@actions/core");
const fs = require("fs");
const path = require("path");
const { Mutex } = require("await-semaphore");


const FOLDER_MIMETYPE = "application/vnd.google-apps.folder";
let folderLock = new Mutex();

//#region GApi
async function login(credentials, token) {
    try {
        /**
         * Get info required to perform the auth from the inputs vars
         * credentials is a JSON value downloaded from the Google Console OAuth
         * token can ve generated running `node login.js`. The file `token.json` will then contain the value
         * UPLOAD THIS VALUES AS SECRETS! NEVER KEEP THEM UNENCRYPTED
         */
        //const credentials = JSON.parse(core.getInput("credentials", { required: true }));
        //const token = JSON.parse(core.getInput("token", { required: true }));
        let auth = new google.auth.OAuth2(
            credentials.web.client_id,
            credentials.web.client_secret,
            credentials.web.redirect_uris[0]
        )
        auth.setCredentials(token);
        core.info("Auth successful");
        return auth;
    } catch (e) {
        core.error(`Authentication failed: ${e}`);
        throw e;
    }
}
function createDriveApi(auth) {
    // Create the Drive API and store it in the global var `drive`
    return google.drive({
        version: "v3",
        auth,
    });
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 */
async function list(drive, q) {
    let files = [];
    let pageToken = undefined;
    do {
        let { data } = await drive.files.list({
            pageSize: 10,
            q,
            pageToken,
            fields: "files(id, appProperties)"
        }).catch(e => {
            core.setFailed(e);
            Promise.reject(e.toString());
        });
        files = files.concat(data.files);
        pageToken = data.nextPageToken;
    } while (pageToken !== undefined);

    return files;
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 * @param {object} options
 * @param options.path Path to the file that will be uploaded
 * @param options.name Name of the file in Drive. Defaults to `options.path` if left empty
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
    core.info(`Uploading file ${options.path} with mime-type ${options.mimeType || "empty"}`);
    try {
        await drive.files.create({
            requestBody: {
                mimeType: options.mimeType,
                name: options.name || options.path,
                parents: options.parents,
                appProperties: {
                    source: options.path,
                    "glob-to-drive": true
                }
            },
            media: {
                mimeType: options.mimeType,
                body: fs.createReadStream(options.path)
            }
        });
    } catch (e) {
        Promise.reject(e);
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

// TODO: Do we really need to run `folderLockRelease()` on every error? Code could be simplified if not
/**
 * Return the ID of the last folder in `options.path`
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 * @param {object} options
 * @param {string} options.path Path in the format 'a/b/c' relative to parent. The folder would be 'c'
 * @param {string} options.parent ID of the folder
 * @param {boolean} options.create Create if it doesn't exists. Error otherwise
 * @returns {String} Folder data
 */
async function folder(drive, options) {
    let parentId = options.parent || `root`;
    // If we are actually uploading to `parent` (As in "no subfolder" then just return the parent ID)
    if (options.path === "") {
        return parentId;
    }
    let pathStructure = options.path.split(path.sep);
    core.info(`Path structure: '${pathStructure}' (${pathStructure.length} element/s)`);
    for (let folderName of pathStructure) {
        let folderLockRelease = await folderLock.acquire(); // Make sure no one is creating folders
        core.info(`Finding folder with name '${folderName}'`);

        let q = `'${parentId}' in parents and name = '${folderName}'`;

        // TODO: Find a better way to choose what folder to use. 
        let folder = await list(drive, q)
            .then(folders => folders[0]) // Take the first, ignore the rest
            .catch(e => {
                folderLockRelease();
                throw e;
            });

        // Take the ID of the folder...
        let currentFolderId = folder ? folder.id : undefined;

        // ...if no folder was found...
        if (currentFolderId === undefined) {
            core.info(`No folder with name ${folderName} was found`);
            if (options.create) {//  ...we check if we are allowed to create one...
                core.info(`Creating folder ${folderName}`);
                currentFolderId = await drive.files.create({
                    requestBody: {
                        name: folderName,
                        parents: [parentId],
                        mimeType: FOLDER_MIMETYPE
                    },
                    fields: 'id'
                })
                    .then(res => res.data.id)
                    .catch(e => {
                        folderLockRelease(); // We are no longer risking a race condition
                        throw e;
                    });
            } else {// ...if not, we fail
                folderLockRelease(); // We are no longer risking a race condition
                throw `The (sub)folder '${folderName}' couldn't be located nor created (Full path: ${options.path}. Query: ${q})`;
            }
        }
        core.info(`Folder '${folderName}' has id '${currentFolderId}'`);
        folderLockRelease(); // We are no longer risking a race condition
        parentId = currentFolderId;
    }
    core.info(`Returning '${parentId}' for '${pathStructure}'`);
    return parentId;
}
//#endregion

module.exports = {
    login, createDriveApi, list, upload, update, folder
}