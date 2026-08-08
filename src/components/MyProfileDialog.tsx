import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { Field, Modal } from "@/components/ui-bits";
import { uploadAvatarPhoto, updateMyProfile } from "@/lib/asana";
import { useInvalidate } from "@/lib/useData";
import type { Member } from "@/lib/domain";

/** Autoatendimento: cada pessoa ajusta o próprio nome, função, contato e foto — sem precisar de admin. */
export function MyProfileDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const invalidateMembers = useInvalidate(["members"]);
  const [name, setName] = useState(member.name);
  const [jobTitle, setJobTitle] = useState(member.job_title ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function pickFile(f: File | null) {
    if (f && f.size > 3 * 1024 * 1024) {
      toast.error("A foto precisa ter até 3 MB.");
      return;
    }
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  const save = useMutation({
    mutationFn: async () => {
      const avatarUrl = file ? await uploadAvatarPhoto(member.id, file) : member.avatar_url;
      await updateMyProfile({ name: name.trim(), job_title: jobTitle, phone, avatar_url: avatarUrl });
    },
    onSuccess: () => {
      invalidateMembers();
      toast.success("Perfil atualizado.");
      onClose();
    },
    onError: (e: unknown) =>
      toast.error(`Não foi possível salvar: ${(e as { message?: string })?.message ?? "erro"}`),
  });

  const canSave = name.trim().length >= 2 && !save.isPending;

  return (
    <Modal
      title="Meu perfil"
      description="Nome, função, contato e foto — visíveis para toda a equipe."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button onClick={() => canSave && save.mutate()} disabled={!canSave} className="btn btn-primary">
            {save.isPending ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <Avatar
          name={name || member.name}
          color={member.avatar_color}
          src={preview ?? member.avatar_url}
          className="size-16 text-base"
        />
        <div className="space-y-1">
          <label className="btn btn-ghost cursor-pointer text-xs">
            Trocar foto
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">PNG, JPG ou WEBP, até 3 MB.</p>
        </div>
      </div>

      <Field label="Nome">
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="field w-full" />
      </Field>
      <Field label="Função">
        <input
          value={jobTitle}
          maxLength={80}
          placeholder="Cargo ou função"
          onChange={(e) => setJobTitle(e.target.value)}
          className="field w-full"
        />
      </Field>
      <Field label="Contato">
        <input
          value={phone}
          maxLength={40}
          placeholder="Telefone, WhatsApp..."
          onChange={(e) => setPhone(e.target.value)}
          className="field w-full"
        />
      </Field>
      <Field label="E-mail" hint="Vinculado à conta de acesso — peça a um admin para alterar.">
        <input value={member.email} disabled className="field w-full opacity-60" />
      </Field>
    </Modal>
  );
}
