// Usage: npm run restore -- <папка-бэкапа>   (сервер должен быть остановлен)
import path from "path";
import {fileURLToPath} from "url";
import {restoreBackup} from "../server/backup.js";
const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),"..");
const dataDir=process.env.SICO_DATA_DIR?path.resolve(process.env.SICO_DATA_DIR):path.join(ROOT,"data");
const src=process.argv[2];
if(!src){console.error("Укажи папку бэкапа: npm run restore -- backups/sico-backup-...");process.exit(1)}
try{
  const r=restoreBackup(path.resolve(src),dataDir);
  console.log("Восстановлено в:",dataDir);
  console.log("Игроков:",r.summary.users,"| транзакций:",r.summary.transactions);
  if(r.moved)console.log("Прежние данные сохранены в:",r.moved);
}catch(e){console.error("Ошибка:",e.message);process.exit(1)}
