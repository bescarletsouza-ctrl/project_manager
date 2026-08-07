-- Vincula automaticamente members.user_id no primeiro login, quando a linha
-- ainda não tem vínculo mas o e-mail bate com a conta autenticada.
--
-- Sem isso, ninguém tinha seu user_id vinculado de verdade: o seletor "Sou"
-- em Minhas Tarefas era só estado local (nunca gravava no banco), e o texto
-- "em Configurações você vincula o e-mail" não correspondia a nenhuma
-- funcionalidade real. Toda conta nova ficava "não vinculada" na tela, e
-- qualquer função de banco que exige user_id = auth.uid() (ex.: o
-- public.is_admin() hoje em produção, standalone, sem fallback por e-mail)
-- nunca reconhecia a pessoa, mesmo com access_role/e-mail corretos — exigia
-- SQL manual por conta (ver sessão de 2026-08-07 sobre a policy de tags).
--
-- Chamada pela tela uma vez por sessão (ver src/routes/_authenticated/route.tsx).
--
-- Só vincula a PRÓPRIA conta (auth.uid() de quem chama), nunca outra; só
-- toca linha com user_id IS NULL (nunca rouba vínculo de outra pessoa); se
-- houver mais de uma linha sem vínculo com o mesmo e-mail (cadastro
-- duplicado), o UNIQUE INDEX members_user_id_key barra a segunda escrita e a
-- chamada falha com erro — fica visível como problema de dado, em vez de
-- vincular a pessoa errada.

CREATE OR REPLACE FUNCTION public.link_current_member()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id FROM public.members WHERE user_id = auth.uid();
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  UPDATE public.members
  SET user_id = auth.uid()
  WHERE user_id IS NULL
    AND lower(trim(email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '#')))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_current_member() FROM public;
GRANT EXECUTE ON FUNCTION public.link_current_member() TO authenticated;
