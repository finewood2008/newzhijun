import i18next from 'i18next';import {initReactI18next} from 'react-i18next';import zh from './locales/zh.json';
const i18n=i18next.createInstance();void i18n.use(initReactI18next).init({lng:'zh',fallbackLng:'zh',resources:{zh:{translation:zh}},interpolation:{escapeValue:false},initImmediate:false});export default i18n;
