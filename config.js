/*
 * ตั้งค่าระบบ KPI กลุ่มการพยาบาล
 *
 * 1) firebase: คัดลอกจาก Firebase Console → ⚙️ Project settings → General → Your apps → Web app → "SDK setup and configuration" (เลือก Config)
 *    ถ้ายังว่าง (apiKey = "") หน้าเว็บจะเปิดใน "โหมดตัวอย่าง" ด้วยข้อมูลจำลอง
 * 2) superAdmins: อีเมลผู้ดูแลหลัก ต้องตรงกับอีเมลในไฟล์ database.rules.json
 *
 * ค่าในไฟล์นี้เปิดเผยได้ (เป็นค่าระบุโปรเจกต์ ไม่ใช่รหัสผ่าน) ความปลอดภัยของข้อมูลมาจาก database.rules.json
 */
window.KPI_CONFIG = {
  firebase: {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },
  superAdmins: ["banmihospital9@gmail.com"],
  orgName: "กลุ่มการพยาบาล"
};
