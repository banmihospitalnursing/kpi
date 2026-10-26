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
    apiKey: "AIzaSyCjNGSobXhVWG1jdzx0D_d4BRZypGyhJIg",
  authDomain: "kpibanmihos.firebaseapp.com",
  databaseURL: "https://kpibanmihos-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kpibanmihos",
  storageBucket: "kpibanmihos.firebasestorage.app",
  messagingSenderId: "570544472479",
  appId: "1:570544472479:web:df8bbe33808e8114cd7daa",
  measurementId: "G-S2MZL772YM"
  },
  superAdmins: ["banmihospital9@gmail.com"],
  orgName: "กลุ่มการพยาบาล"
};
