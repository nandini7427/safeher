export type LocalEvidence = {
  id: number;
  incidentId: number;
  filename: string;
  createdAt: string;
  blob: Blob;
};

export type LocalEvidenceInfo = Omit<LocalEvidence, "blob">;

const DB_NAME = "SafeHerEvidenceDB";
const STORE_NAME = "recordings";

function openEvidenceDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser local storage is unavailable."));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });

        store.createIndex("incidentId", "incidentId", {
          unique: false,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not open evidence storage."));
  });
}

export async function saveLocalEvidence(
  evidence: Omit<LocalEvidence, "id">
): Promise<number> {
  const db = await openEvidenceDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).add(evidence);

    request.onsuccess = () => resolve(Number(request.result));

    request.onerror = () =>
      reject(request.error || new Error("Could not save the recording."));

    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}

export async function listLocalEvidence(): Promise<LocalEvidenceInfo[]> {
  const db = await openEvidenceDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      const records = request.result as LocalEvidence[];

      resolve(
        records.map(({ id, incidentId, filename, createdAt }) => ({
          id,
          incidentId,
          filename,
          createdAt,
        }))
      );
    };

    request.onerror = () =>
      reject(request.error || new Error("Could not load local recordings."));

    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}

export async function getLocalEvidence(
  id: number
): Promise<LocalEvidence | null> {
  const db = await openEvidenceDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);

    request.onsuccess = () =>
      resolve((request.result as LocalEvidence) || null);

    request.onerror = () =>
      reject(request.error || new Error("Could not retrieve the recording."));

    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}
