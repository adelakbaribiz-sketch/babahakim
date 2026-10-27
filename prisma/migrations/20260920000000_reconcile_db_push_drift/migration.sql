-- AlterTable
ALTER TABLE "AIModel" ADD COLUMN "confidenceThreshold" REAL;
ALTER TABLE "AIModel" ADD COLUMN "driftBaseline" TEXT;
ALTER TABLE "AIModel" ADD COLUMN "preprocessingVersion" TEXT;
ALTER TABLE "AIModel" ADD COLUMN "promptKey" TEXT;
ALTER TABLE "AIModel" ADD COLUMN "promptVersion" INTEGER;
ALTER TABLE "AIModel" ADD COLUMN "trainingDatasetVersion" TEXT;

-- CreateTable
CREATE TABLE "AIPromptTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "nameFa" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "variables" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AIDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "splitPolicy" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "frozenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AIDatasetItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "analysisId" TEXT,
    "imageId" TEXT,
    "caseCode" TEXT,
    "patientHash" TEXT,
    "aiPrediction" TEXT,
    "aiConfidence" REAL,
    "expert1Label" TEXT,
    "expert1ById" TEXT,
    "expert2Label" TEXT,
    "expert2ById" TEXT,
    "finalLabel" TEXT,
    "disagreement" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_LABEL',
    "excludedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIDatasetItem_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "AIDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AIDatasetItem_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIInferenceLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT,
    "caseId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "modelId" TEXT,
    "modelName" TEXT NOT NULL,
    "modelVersion" INTEGER NOT NULL,
    "datasetVersion" TEXT,
    "promptKey" TEXT,
    "promptVersion" INTEGER,
    "preprocessingVersion" TEXT,
    "inputSha256" TEXT,
    "confidence" REAL,
    "quality" REAL,
    "processingMs" INTEGER,
    "costUnits" REAL,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "errorCode" TEXT,
    "replay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIInferenceLog_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AIInferenceLog_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIEvaluationReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT,
    "datasetId" TEXT,
    "metrics" TEXT NOT NULL,
    "summary" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIEvaluationReport_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AIEvaluationReport_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "AIDataset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accessClass" TEXT NOT NULL DEFAULT 'PRIVATE',
    "lifecycleState" TEXT NOT NULL DEFAULT 'ACTIVE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "caseId" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" DATETIME,
    "deletedAt" DATETIME,
    "purgedAt" DATETIME,
    "rejectionReason" TEXT,
    "fileName" TEXT,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StoredFileVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileName" TEXT,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "metadata" TEXT,
    "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "scanEngine" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoredFileVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFileVariant_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "StoredFileVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MedicalImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "caseId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "storedFileId" TEXT,
    "originalPath" TEXT NOT NULL,
    "compressedPath" TEXT,
    "aiPath" TEXT,
    "thumbPath" TEXT,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sizeOriginal" INTEGER NOT NULL,
    "sizeCompressed" INTEGER,
    "mime" TEXT NOT NULL,
    "quality" TEXT,
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MedicalImage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MedicalImage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MedicalCase" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MedicalImage_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "StoredFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MedicalImage" ("aiPath", "caseId", "compressedPath", "createdAt", "height", "id", "mime", "originalPath", "ownerId", "quality", "rejectionReason", "sha256", "sizeCompressed", "sizeOriginal", "status", "thumbPath", "type", "version", "width") SELECT "aiPath", "caseId", "compressedPath", "createdAt", "height", "id", "mime", "originalPath", "ownerId", "quality", "rejectionReason", "sha256", "sizeCompressed", "sizeOriginal", "status", "thumbPath", "type", "version", "width" FROM "MedicalImage";
DROP TABLE "MedicalImage";
ALTER TABLE "new_MedicalImage" RENAME TO "MedicalImage";
CREATE INDEX "MedicalImage_caseId_createdAt_idx" ON "MedicalImage"("caseId", "createdAt");
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "descriptionFa" TEXT,
    "descriptionEn" TEXT,
    "imagePath" TEXT,
    "imageFileId" TEXT,
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT false,
    "usageFa" TEXT,
    "restrictions" TEXT,
    "currentPrice" INTEGER NOT NULL DEFAULT 0,
    "purchasePrice" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_imageFileId_fkey" FOREIGN KEY ("imageFileId") REFERENCES "StoredFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("active", "brand", "category", "createdAt", "currentPrice", "deletedAt", "descriptionEn", "descriptionFa", "id", "imagePath", "nameEn", "nameFa", "purchasePrice", "requiresPrescription", "restrictions", "sku", "stock", "updatedAt", "usageFa") SELECT "active", "brand", "category", "createdAt", "currentPrice", "deletedAt", "descriptionEn", "descriptionFa", "id", "imagePath", "nameEn", "nameFa", "purchasePrice", "requiresPrescription", "restrictions", "sku", "stock", "updatedAt", "usageFa" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AIPromptTemplate_key_status_idx" ON "AIPromptTemplate"("key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AIPromptTemplate_key_version_key" ON "AIPromptTemplate"("key", "version");

-- CreateIndex
CREATE INDEX "AIDataset_status_idx" ON "AIDataset"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AIDataset_name_version_key" ON "AIDataset"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AIDatasetItem_analysisId_key" ON "AIDatasetItem"("analysisId");

-- CreateIndex
CREATE INDEX "AIDatasetItem_datasetId_reviewStatus_idx" ON "AIDatasetItem"("datasetId", "reviewStatus");

-- CreateIndex
CREATE INDEX "AIDatasetItem_datasetId_disagreement_idx" ON "AIDatasetItem"("datasetId", "disagreement");

-- CreateIndex
CREATE UNIQUE INDEX "AIInferenceLog_analysisId_key" ON "AIInferenceLog"("analysisId");

-- CreateIndex
CREATE INDEX "AIInferenceLog_createdAt_idx" ON "AIInferenceLog"("createdAt");

-- CreateIndex
CREATE INDEX "AIInferenceLog_modelName_createdAt_idx" ON "AIInferenceLog"("modelName", "createdAt");

-- CreateIndex
CREATE INDEX "AIEvaluationReport_modelId_createdAt_idx" ON "AIEvaluationReport"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "StoredFile_ownerId_createdAt_idx" ON "StoredFile"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "StoredFile_lifecycleState_expiresAt_idx" ON "StoredFile"("lifecycleState", "expiresAt");

-- CreateIndex
CREATE INDEX "StoredFile_status_idx" ON "StoredFile"("status");

-- CreateIndex
CREATE INDEX "StoredFileVersion_fileId_idx" ON "StoredFileVersion"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFileVersion_fileId_version_key" ON "StoredFileVersion"("fileId", "version");

-- CreateIndex
CREATE INDEX "StoredFileVariant_versionId_idx" ON "StoredFileVariant"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFileVariant_versionId_variant_key" ON "StoredFileVariant"("versionId", "variant");

