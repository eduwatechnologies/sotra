import "dotenv/config";
import { startApplication } from "./app";
import { safeErrorText } from "./logging";

startApplication().catch((error: unknown) => {
  console.error(
    `Sotra Signals failed to start. ${safeErrorText(error, [
      process.env.TELEGRAM_BOT_TOKEN ?? "",
      process.env.TWELVE_DATA_API_KEY ?? "",
    ])}`
  );
  process.exitCode = 1;
});
