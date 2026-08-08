-- Perfil próprio: cada pessoa ajusta nome, função, contato e foto — sem
-- precisar de admin. Foto some no Avatar em qualquer lugar do app assim que
-- trocada.
--
-- Bucket público (diferente do task-attachments, que é privado): avatar
-- aparece dezenas de vezes por tela (sidebar, cards, menções, atribuição),
-- então precisa de URL direta e cacheável — signed URL de 5 min como a de
-- anexo obrigaria re-assinar o tempo todo.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS phone text;

-- ---------- bucket no Storage ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatar-photos',
  'avatar-photos',
  true, -- público: URL direta, sem signed URL
  3 * 1024 * 1024, -- 3 MB por foto
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ---------- políticas no storage.objects ----------
-- Convenção: primeiro segmento do path é o member_id de quem é dono da foto.
-- Leitura pública não passa por RLS (bucket público), mas a policy abaixo
-- cobre quem acessa via API autenticada mesmo assim.

CREATE POLICY "avatar-photos read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'avatar-photos'
);

CREATE POLICY "avatar-photos upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'avatar-photos'
  AND (
    public.is_admin()
    OR (split_part(name, '/', 1))::uuid = public.current_member_id()
  )
);

CREATE POLICY "avatar-photos update" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'avatar-photos'
  AND (
    public.is_admin()
    OR (split_part(name, '/', 1))::uuid = public.current_member_id()
  )
);

CREATE POLICY "avatar-photos delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'avatar-photos'
  AND (
    public.is_admin()
    OR (split_part(name, '/', 1))::uuid = public.current_member_id()
  )
);

-- ---------- edição do próprio perfil ----------
-- NÃO afrouxa a policy "members write" (continua só admin) — em vez disso,
-- uma função estreita que só toca nome/função/contato/foto da PRÓPRIA linha
-- (resolvida por current_member_id(), a mesma identidade usada em toda RLS
-- deste projeto). Faz isso de propósito em vez de liberar UPDATE geral na
-- própria linha: com UPDATE geral, a mesma requisição que troca o nome
-- também poderia trocar access_role, department_id, user_id etc. — a policy
-- de RLS não tem como restringir coluna por coluna, só função pode.
CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_name text,
  p_job_title text,
  p_phone text,
  p_avatar_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.current_member_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Conta não vinculada a um membro da equipe.';
  END IF;

  UPDATE public.members
  SET name = COALESCE(NULLIF(trim(p_name), ''), name),
      job_title = NULLIF(trim(p_job_title), ''),
      phone = NULLIF(trim(p_phone), ''),
      avatar_url = p_avatar_url
  WHERE id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text, text, text) TO authenticated;
