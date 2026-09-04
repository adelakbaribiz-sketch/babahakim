-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AIAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "modelId" TEXT,
    "modelName" TEXT NOT NULL DEFAULT 'TongueModelV1',
    "modelVersion" INTEGER NOT NULL DEFAULT 1,
    "predictions" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "quality" REAL NOT NULL,
    "features" TEXT,
    "explainability" TEXT,
    "processingMs" INTEGER,
    "humanReviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewComment" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIAnalysis_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MedicalCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AIAnalysis_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MedicalImage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AIAnalysis_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AIAnalysis" ("caseId", "confidence", "createdAt", "explainability", "features", "humanReviewed", "id", "imageId", "modelId", "modelName", "modelVersion", "predictions", "processingMs", "quality") SELECT "caseId", "confidence", "createdAt", "explainability", "features", "humanReviewed", "id", "imageId", "modelId", "modelName", "modelVersion", "predictions", "processingMs", "quality" FROM "AIAnalysis";
DROP TABLE "AIAnalysis";
ALTER TABLE "new_AIAnalysis" RENAME TO "AIAnalysis";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
