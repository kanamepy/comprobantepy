/**
 * Crea un usuario desde la terminal. Uso:
 *   npm run crear-usuario -- --email ana@ejemplo.com --nombre "Ana" --admin
 * La contraseña se pide por teclado.
 */
import { sql } from "drizzle-orm";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { registrarAuditoria } from "../auditoria.js";
import { hashPassword, LONGITUD_MINIMA_PASSWORD } from "../auth/password.js";
import { crearConexion } from "../db/conexion.js";
import { usuarios } from "../db/esquema.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    nombre: { type: "string" },
    admin: { type: "boolean", default: false },
    password: { type: "string" },
  },
});

if (!values.email || !values.nombre) {
  console.error('Uso: npm run crear-usuario -- --email correo@ejemplo.com --nombre "Nombre" [--admin]');
  process.exit(1);
}

let password = values.password ?? process.env.PASSWORD_NUEVO_USUARIO;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question(`Contraseña (mínimo ${LONGITUD_MINIMA_PASSWORD} caracteres): `);
  rl.close();
}
if (password.length < LONGITUD_MINIMA_PASSWORD) {
  console.error(`La contraseña debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres.`);
  process.exit(1);
}

const { db, pool } = crearConexion();
try {
  const email = values.email.trim().toLowerCase();
  const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(sql`lower(${usuarios.email}) = ${email}`);
  if (existente) {
    console.error(`Ya existe un usuario con el correo ${email}.`);
    process.exitCode = 1;
  } else {
    const [creado] = await db
      .insert(usuarios)
      .values({ email, nombre: values.nombre, passwordHash: await hashPassword(password), esAdministrador: values.admin })
      .returning({ id: usuarios.id });
    await registrarAuditoria(db, {
      entidad: "usuario",
      entidadId: creado!.id,
      accion: "CREAR",
      valorNuevo: { email, nombre: values.nombre, esAdministrador: values.admin },
      origen: "CLI",
    });
    console.log(`Usuario ${email} creado (id ${creado!.id}).`);
    if (values.admin) console.log("Al iniciar sesión se pedirá configurar el segundo factor (TOTP).");
  }
} finally {
  await pool.end();
}
