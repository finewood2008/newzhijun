export const MAX_FILE_SIZE=32*1024*1024;
/** Sequential per-file requests keep large selections bounded and allow partial success. */
export async function uploadBatch(items,{upload,onUpdate,signal}) {
 for(const item of items){
  if(signal.aborted)break;
  if(item.file.size>MAX_FILE_SIZE){onUpdate(item.id,'failed','单个文件最多 32 MB。');continue;}
  onUpdate(item.id,'uploading','');
  try{await upload(item.file,signal);if(!signal.aborted)onUpdate(item.id,'uploaded','');}
  catch(e){if(signal.aborted)break;onUpdate(item.id,'failed',e instanceof Error?e.message:'上传失败，请重试。');}
 }
}
