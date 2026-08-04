-- Cadastro só para e-mails liberados em Configurações > Equipe.
--
-- A tabela members só é legível por quem já está autenticado, e quem está se
-- cadastrando ainda não está. Esta função roda como dona da tabela e devolve
-- apenas um booleano — não expõe a lista de pessoas.

CREATE OR REPLACE FUNCTION public.email_liberado(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.members
    WHERE lower(email) = lower(trim(p_email))
  );
$$;

REVOKE ALL ON FUNCTION public.email_liberado(text) FROM public;
GRANT EXECUTE ON FUNCTION public.email_liberado(text) TO anon, authenticated;
