-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "limitAppointments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxAppointmentsDisplayed" INTEGER NOT NULL DEFAULT 10;
