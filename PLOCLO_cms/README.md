# 📦 Ploclo CMS

Ploclo CMS is a full-stack web application built with:

- **Next.js** (Frontend)
- **Node.js** (Backend)
- **PostgreSQL** (Database)
- **Prisma ORM**

This guide explains how to set up and run the project using **Docker**.

---

## 🚀 Prerequisites

Make sure you have installed:

- [Docker Desktop](https://www.docker.com/)
- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) _(optional for local development)_

---

## 🔽 Clone the Project

```bash
git clone <your-repo-url>
cd ploclo-cms
⚙️ Backend .env Configuration
Create a file named .env inside the backend/ folder:

env

DATABASE_URL="postgresql://postgres:admin123@postgres:5432/myapp"
JWT_SECRET="your_jwt_secret_here"
PORT=3001
🧠 Note: The DATABASE_URL host must be postgres to match the Docker service name.

🐳 Docker Setup
Below is the docker-compose.yml configuration:

yaml

version: "3.9"
services:
  postgres:
    image: postgres:15
    container_name: postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: admin123
      POSTGRES_DB: myapp
    ports:
      - "5432:5432"

  backend:
    build: ./backend
    container_name: backend
    depends_on:
      - postgres
    env_file:
      - ./backend/.env
    ports:
      - "3001:3001"
    command: sh -c "sleep 5 && npx prisma db push && node dist/index.js"

  frontend:
    build: ./frontend
    container_name: frontend
    ports:
      - "3000:3000"

🧩 Explanation
sleep 5 → Waits for PostgreSQL to start
npx prisma db push → Syncs Prisma schema to the database
node dist/index.js → Starts the backend server
▶️ Running the Project
Start and build all services:

bash
docker-compose up -d --build
Check running containers:

bash
docker ps
🌐 Access the Services
Frontend → http://localhost:3000
Backend → http://localhost:3001
PostgreSQL → localhost:5432
🛠 Prisma Commands
Sync Prisma schema with the database:

⚠️ Notes
bash
docker exec -it backend npx prisma db push
Reset the database (⚠️ deletes all data):

bash
docker exec -it backend npx prisma migrate reset
🌍 Running on Another Machine
Clone the repository:

bash
git clone <your-repo-url>
cd ploclo-cms
Add .env inside backend/.
Start Docker:

bash
docker-compose up -d --build
The backend will automatically push the Prisma schema to the database.


```
 ## Fix Critical 🚨⚠️❗🚩 
 ```
     Fix frontend Next.js
cd frontend
npm install next@latest
rmdir /s /q node_modules >>> ลบของเก่า
npm install
type node_modules\next\package.json | findstr "\"version\"" หรือ npx next --version ตรวจเวอร์ชัน

    Fix untgz
อยู่ path root
npm install

```
# 🚀 CI Pipeline (SonarQube)

## ⚙️ How It Works

เมื่อมีการ push code ไปที่ branch `main`:

- GitHub Actions จะถูก trigger อัตโนมัติ  
- ทำการ:
  - checkout โค้ด
  - run SonarQube Scan  
- ผลลัพธ์จะถูกส่งไปที่ SonarQube server

---

🐳 Run SonarQube =================================================================
```bash 
docker run -d --name sonarqube -p 9000:9000 sonarqube:lts
เข้าใช้งาน: http://<ip>:9000

==========================🔐 Create Token===========================================
🌍 SonarQube → My Account → Security → Generate Token
====================================================================================
🔐 Required Secrets (สำคัญ)
Settings → Secrets and variables → Actions → New repository secret
1.SONAR_TOKEN เช่น f5a1b37f9b5d76d01661385e4fbaf7f644a0c3a6
2.SONAR_HOST_URL http://<ip>:9000 เช่น http://104.197.255.217:9000
====================================================================================
🔧 ทางเลือก (ไม่ต้องใช้ Secrets สำหรับ SONAR_HOST_URL)
สามารถใช้ ngrok เพื่อสร้าง public URL:
ngrok http 9000
จะได้ URL แบบ: https://xxxx.ngrok-free.app
👉 เอาไปใส่ใน: SONAR_HOST_URL: https://xxxx.ngrok-free.app ในไฟล์ ci.yml
⚠️ หมายเหตุ:
URL ของ ngrok อาจเปลี่ยนทุกครั้งที่รัน
====================================================================================

🛠️ Troubleshooting
❌ SonarQube scan ไม่ทำงาน
ตรวจสอบ SONAR_TOKEN
ตรวจสอบ URL ของ SonarQube

❌ ห้ามใช้ localhost
❌ ห้ามใช้ IP ส่วนตัว (ถ้า GitHub เข้าถึงไม่ได้)
✅ ต้องเป็น public URL เท่านั้น