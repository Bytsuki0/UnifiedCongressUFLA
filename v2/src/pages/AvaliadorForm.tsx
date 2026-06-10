import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// Schema de validação centralizado (client-side); o banco também garante email único
const avaliadorSchema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório").max(100, "Nome muito longo"),
  email: z
    .string()
    .trim()
    .min(1, "Email é obrigatório")
    .email("Email inválido")
    .max(255, "Email muito longo"),
  instituicao: z.string().trim().min(1, "Instituição é obrigatória").max(150, "Texto muito longo"),
});

const AvaliadorForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState({ nome: "", email: "", instituicao: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data, error } = await supabase
        .from("avaliadores")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        toast.error("Avaliador não encontrado");
        navigate("/avaliadores");
        return;
      }
      setForm({ nome: data.nome, email: data.email, instituicao: data.instituicao });
    })();
  }, [id, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = avaliadorSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        if (i.path[0]) fieldErrors[i.path[0] as string] = i.message;
      });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);

    const payload = {
      nome: parsed.data.nome,
      email: parsed.data.email,
      instituicao: parsed.data.instituicao,
    };
    const { error } = isEdit
      ? await supabase.from("avaliadores").update(payload).eq("id", id!)
      : await supabase.from("avaliadores").insert(payload);

    if (error) {
      // Código 23505 = violação de unique constraint (email duplicado)
      if (error.code === "23505") toast.error("Já existe um avaliador com esse email");
      else toast.error(isEdit ? "Erro ao atualizar" : "Erro ao cadastrar");
    } else {
      toast.success(isEdit ? "Avaliador atualizado" : "Avaliador cadastrado");
      navigate("/avaliadores");
    }
    setSaving(false);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/avaliadores">
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Link>
      </Button>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle>{isEdit ? "Editar avaliador" : "Novo avaliador"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="nome">Nome *</Label>
              <Input
                id="nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                aria-invalid={!!errors.nome}
              />
              {errors.nome && <p className="text-xs text-destructive">{errors.nome}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                aria-invalid={!!errors.email}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="instituicao">Instituição *</Label>
              <Input
                id="instituicao"
                value={form.instituicao}
                onChange={(e) => setForm({ ...form, instituicao: e.target.value })}
                aria-invalid={!!errors.instituicao}
              />
              {errors.instituicao && (
                <p className="text-xs text-destructive">{errors.instituicao}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate("/avaliadores")}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AvaliadorForm;
