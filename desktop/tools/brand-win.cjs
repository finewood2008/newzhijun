const fs=require('node:fs'),path=require('node:path'),PE=require('pe-library'),R=require('resedit');
module.exports=async context=>{
 if(context.electronPlatformName!=='win32')return;
 const file=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe');
 const exe=PE.NtExecutable.from(fs.readFileSync(file)),resources=PE.NtExecutableResource.from(exe);
 const icons=R.Data.IconFile.from(fs.readFileSync(path.join(__dirname,'../resources/icon.ico'))).icons.map(i=>i.data);
 const groups=R.Resource.IconGroupEntry.fromEntries(resources.entries);
 for(const group of groups)R.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icons);
 for(const version of R.Resource.VersionInfo.fromEntries(resources.entries)){
  for(const lang of version.getAllLanguagesForStringValues())version.setStringValues(lang,{FileDescription:'知君 · 私人空间',ProductName:'知君',CompanyName:'CentaurAI',OriginalFilename:'知君.exe',InternalName:'zhijun',LegalCopyright:'CentaurAI'});
  const numbers=context.packager.appInfo.version.split('.').map(Number);version.setFileVersion(...numbers,0);version.setProductVersion(...numbers,0);version.outputToResourceEntries(resources.entries);
 }
 resources.outputResource(exe);fs.writeFileSync(file,Buffer.from(exe.generate()));
};
