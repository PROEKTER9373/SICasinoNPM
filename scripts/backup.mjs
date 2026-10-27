// Usage: npm run backup [-- <папка назначения>]
import path from "path";
import {fileURLToPath} from "url";
import {fullBackup} from "../server/backup.js";
const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),"..");
const dataDir=process.env.SICO_DATA_DIR?path.resolve(process.env.SICO_DATA_DIR):path.join(ROOT,"data");
const out=path.resolve(process.argv[2]||path.join(ROOT,"backups"));
try{
  const {dir,manifest}=fullBackup(dataDir,out);
  console.log("Бэкап готов:",dir);
  console.log("Игроков:",manifest.summary.users,"| транзакций:",manifest.summary.transactions,"| аватаров:",manifest.avatars,"| admin.key:",manifest.adminKey?"да":"нет");
  console.log("Для переноса скопируй эту папку на новое место и выполни: npm run restore -- <папка>");
}catch(e){console.error("Ошибка:",e.message);process.exit(1)}
