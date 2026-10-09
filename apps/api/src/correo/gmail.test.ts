import type { gmail_v1 } from "@googleapis/gmail";
import { describe, expect, it } from "vitest";
import { adaptadorGmail, ErrorAutenticacionCorreo } from "./gmail.js";

/** Cliente de Gmail simulado que registra las llamadas. */
function clienteSimulado(opciones: { fallar?: boolean } = {}) {
  const llamadas: { metodo: string; parametros: unknown }[] = [];
  const registrar = (metodo: string) => async (parametros: unknown) => {
    llamadas.push({ metodo, parametros });
    if (opciones.fallar) throw Object.assign(new Error("invalid_grant"), { response: { status: 400, data: { error: "invalid_grant" } } });
    if (metodo === "messages.list") return { data: { messages: [{ id: "b" }, { id: "a" }] } };
    if (metodo === "messages.get") return { data: { raw: Buffer.from("From: x@y.com\r\n\r\nhola").toString("base64url") } };
    if (metodo === "labels.list") return { data: { labels: [{ name: "CPY-Leido", id: "L1" }] } };
    if (metodo === "labels.create") return { data: { id: "L2" } };
    return { data: {} };
  };
  const cliente = {
    users: {
      messages: { list: registrar("messages.list"), get: registrar("messages.get"), modify: registrar("messages.modify"), delete: registrar("messages.delete"), trash: registrar("messages.trash") },
      labels: { list: registrar("labels.list"), create: registrar("labels.create") },
    },
  } as unknown as gmail_v1.Gmail;
  return { cliente, llamadas };
}

describe("adaptador de Gmail", () => {
  it("lee solo la etiqueta configurada, sin los ya procesados, del más antiguo al más nuevo", async () => {
    const { cliente, llamadas } = clienteSimulado();
    const ids = await adaptadorGmail("token", "label:Comprobantes", cliente).listarPendientes();
    expect(ids).toEqual(["a", "b"]);
    expect(llamadas[0]).toMatchObject({ metodo: "messages.list", parametros: { q: expect.stringMatching(/^label:Comprobantes -label:cpy-leido/) } });
  });

  it("descarga el mensaje completo y lo etiqueta sin borrarlo ni archivarlo", async () => {
    const { cliente, llamadas } = clienteSimulado();
    const adaptador = adaptadorGmail("token", null, cliente);
    expect((await adaptador.obtenerCrudo("a")).toString()).toContain("hola");
    await adaptador.marcar("a", "SIN_ADJUNTOS");
    expect(llamadas.find((l) => l.metodo === "labels.create")).toMatchObject({ parametros: { requestBody: { name: "CPY-Sin-adjuntos" } } });
    expect(llamadas.find((l) => l.metodo === "messages.modify")).toMatchObject({ parametros: { id: "a", requestBody: { addLabelIds: ["L1", "L2"] } } });
    expect(llamadas.some((l) => l.metodo === "messages.delete" || l.metodo === "messages.trash")).toBe(false);
  });

  it("traduce un token vencido en un error de autenticación", async () => {
    const { cliente } = clienteSimulado({ fallar: true });
    await expect(adaptadorGmail("token", null, cliente).listarPendientes()).rejects.toBeInstanceOf(ErrorAutenticacionCorreo);
  });
});
