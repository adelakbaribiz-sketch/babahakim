-- DropIndex
DROP INDEX "User_phone_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "ageRecordedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "ageYears" INTEGER;
ALTER TABLE "User" ADD COLUMN "nationalIdEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "nationalIdHash" TEXT;

-- AlterTable
ALTER TABLE "OtpChallenge" ADD COLUMN "userId" TEXT;

-- AlterTable
ALTER TABLE "MedicalCase" ADD COLUMN "archiveReason" TEXT;
ALTER TABLE "MedicalCase" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "MedicalCase" ADD COLUMN "archivedById" TEXT;

-- CreateTable
CREATE TABLE "ClinicalVocabulary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "valueFa" TEXT NOT NULL,
    "valueEn" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionnaireId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "textFa" TEXT NOT NULL,
    "textEn" TEXT NOT NULL,
    "helpFa" TEXT,
    "helpEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "weight" REAL NOT NULL DEFAULT 1,
    "category" TEXT,
    CONSTRAINT "Question_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Question" ("active", "helpEn", "helpFa", "id", "order", "questionnaireId", "textEn", "textFa") SELECT "active", "helpEn", "helpFa", "id", "order", "questionnaireId", "textEn", "textFa" FROM "Question";
DROP TABLE "Question";
ALTER TABLE "new_Question" RENAME TO "Question";
CREATE TABLE "new_QuestionnaireResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "answers" TEXT NOT NULL,
    "scores" TEXT NOT NULL,
    "mizajFa" TEXT NOT NULL,
    "mizajEn" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "answeredCount" INTEGER,
    "totalQuestions" INTEGER,
    "questionnaireVersion" INTEGER,
    "scoringVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionnaireResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionnaireResponse_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_QuestionnaireResponse" ("answers", "createdAt", "id", "mizajEn", "mizajFa", "questionnaireId", "scores", "summary", "userId") SELECT "answers", "createdAt", "id", "mizajEn", "mizajFa", "questionnaireId", "scores", "summary", "userId" FROM "QuestionnaireResponse";
DROP TABLE "QuestionnaireResponse";
ALTER TABLE "new_QuestionnaireResponse" RENAME TO "QuestionnaireResponse";
CREATE INDEX "QuestionnaireResponse_userId_createdAt_idx" ON "QuestionnaireResponse"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ClinicalVocabulary_kind_active_order_idx" ON "ClinicalVocabulary"("kind", "active", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalVocabulary_kind_valueFa_key" ON "ClinicalVocabulary"("kind", "valueFa");

-- CreateIndex
CREATE UNIQUE INDEX "User_nationalIdHash_key" ON "User"("nationalIdHash");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "MedicalCase_archivedAt_createdAt_idx" ON "MedicalCase"("archivedAt", "createdAt");

