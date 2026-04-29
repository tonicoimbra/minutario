(function (global) {
  var SCOPES = ["https://www.googleapis.com/auth/drive.file"];
  var FILE_NAME = "minutario-backup.json";
  var MIME_TYPE = "application/json";

  async function getAuthToken() {
    return new Promise(function (resolve, reject) {
      chrome.identity.getAuthToken({ interactive: true }, function (token) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });
  }

  async function revokeToken(token) {
    return new Promise(function (resolve) {
      chrome.identity.removeCachedAuthToken({ token: token }, function () {
        resolve();
      });
    });
  }

  async function apiRequest(url, options) {
    var token = await getAuthToken();
    var response = await fetch(url, {
      headers: {
        ...(options.headers || {}),
        Authorization: "Bearer " + token,
      },
      ...options,
    });

    if (response.status === 401) {
      await revokeToken(token);
      throw new Error("Authentication required");
    }

    if (!response.ok) {
      throw new Error("Drive API error: " + response.status);
    }

    return response;
  }

  async function findBackupFile() {
    var query = encodeURIComponent("name='" + FILE_NAME + "' and trashed=false");
    var response = await apiRequest(
      "https://www.googleapis.com/drive/v3/files?q=" + query + "&spaces=drive",
      { method: "GET" }
    );
    var data = await response.json();
    return data.files && data.files[0] ? data.files[0].id : null;
  }

  async function uploadFile(fileId, content) {
    var metadata = {
      name: FILE_NAME,
      mimeType: MIME_TYPE,
    };

    var boundary = "-------314159265358979323846";
    var delimiter = "\r\n--" + boundary + "\r\n";
    var closeDelim = "\r\n--" + boundary + "--";

    var body =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: " + MIME_TYPE + "\r\n\r\n" +
      content +
      closeDelim;

    var url = fileId
      ? "https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=multipart"
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

    var response = await apiRequest(url, {
      method: fileId ? "PATCH" : "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body: body,
    });

    var result = await response.json();
    return result.id;
  }

  async function downloadFile(fileId) {
    var response = await apiRequest(
      "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media",
      { method: "GET" }
    );
    return response.text();
  }

  async function init() {
    try {
      await getAuthToken();
      return true;
    } catch (error) {
      return false;
    }
  }

  async function backup(data) {
    var content = JSON.stringify(data, null, 2);
    var fileId = await findBackupFile();
    var newFileId = await uploadFile(fileId, content);
    return { success: true, fileId: newFileId };
  }

  async function restore() {
    var fileId = await findBackupFile();
    if (!fileId) {
      return { success: false, error: "Nenhum backup encontrado no Drive" };
    }
    var content = await downloadFile(fileId);
    var data = JSON.parse(content);
    return { success: true, data: data };
  }

  async function logout() {
    try {
      var token = await getAuthToken();
      await revokeToken(token);
    } catch (error) {
      // Ignore
    }
  }

  global.DriveSync = {
    init: init,
    backup: backup,
    restore: restore,
    logout: logout,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
