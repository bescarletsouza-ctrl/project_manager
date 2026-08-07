-- Corrige public.current_member_id(), usada por current_member_role() e por
-- is_admin(), que por sua vez sustenta TODAS as policies "USING (public.is_admin())"
-- (departments, clients, portfolios, members, projects insert/delete, tags write etc).
--
-- Sintoma: usuário marcado como admin (members.access_role = 'admin') recebe
-- "new row violates row-level security policy" ao tentar criar uma etiqueta,
-- mesmo com a policy "tags write" corretamente escrita como
-- USING (public.is_admin()) WITH CHECK (public.is_admin()).
--
-- Causa raiz: current_member_id() só cai no fallback por e-mail quando
-- members.user_id IS NULL:
--
--   WHERE user_id = auth.uid()
--      OR (user_id IS NULL AND lower(email) = lower(auth.jwt()->>'email'))
--
-- Só que a resolução de identidade usada pela tela (src/lib/access.ts,
-- resolveCurrentMember/useAccessRole) NÃO tem essa restrição: ela procura por
-- user_id igual ao do usuário logado e, se não achar, cai para QUALQUER member
-- cujo e-mail bata — independente do user_id daquela linha estar nulo ou
-- apontando para outra coisa. Isso é o que faz a interface mostrar "você é
-- admin" (ela achou a linha pelo e-mail) enquanto o banco nega a escrita (a
-- função SQL não achou nada, porque o user_id da linha não era NULL nem igual
-- ao auth.uid() atual — típico de conta recriada, linha vinculada
-- manualmente, ou vínculo antigo que ficou perdido).
--
-- Não há tabelas paralelas (profiles/user_roles) neste projeto: a única fonte
-- de nível de acesso é public.members.access_role. E a policy de leitura de
-- members ("members read" USING (true)) já é aberta para authenticated, e as
-- funções abaixo são SECURITY DEFINER, então RLS de members não é o que
-- bloqueia is_admin() consultar o próprio registro — o problema é só a
-- condição do fallback por e-mail.
--
-- Fix: o fallback por e-mail passa a valer sempre que a linha não estiver
-- vinculada ao auth.uid() atual (nulo OU apontando para outro id), com
-- trim() para não quebrar por espaço em branco no cadastro. Quando existir
-- uma linha com user_id = auth.uid(), ela sempre vence (ORDER BY prioriza o
-- match exato). Isso não afrouxa nenhuma policy: continua exigindo
-- access_role = 'admin' na linha resolvida para is_admin() retornar true.

CREATE OR REPLACE FUNCTION public.current_member_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id FROM public.members
  WHERE user_id = auth.uid()
     OR lower(trim(email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '#')))
  ORDER BY (user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1;
$$;
